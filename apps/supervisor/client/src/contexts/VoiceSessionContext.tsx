import type {
  CostPushEntry,
  LogPushEntry,
  LogPushSessionUpdate,
  MailPush,
  SessionHeartbeatUpdate,
  SessionPush,
} from "@naisys/hub-protocol";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSubscription } from "../hooks/socket/useSubscription";
import { isRunActive } from "../hooks/threadRuns/runStatus";
import type { VoiceMode } from "../lib/api/apiClient";
import { getRunsData } from "../lib/api/apiRuns";
import {
  chatMessagesRoomKey,
  imagesFromChatMessage,
} from "../lib/voice/voiceChatImages";
import {
  createVoiceSession,
  type VoiceSession,
  type VoiceSessionDisplay,
} from "../lib/voice/voiceSession";

/**
 * Thin React shell around {@link createVoiceSession}. The session object owns
 * WebRTC, mic, narration timing, and tool/cost dispatch; the provider owns
 * React state, the audio sink, and the run-log subscription. One session per
 * browser in phase 1; startSession aborts and replaces any existing instance.
 *
 * Run-log target tracking is event-driven off the `runs:${target}` socket
 * room (the same feed the runs page uses): one REST snapshot when the voice
 * session opens, then `new-session` / `heartbeat-update` events keep
 * {@link LogTarget} latched onto the right (run, session, subagent) across
 * compaction, subagent handoff, and cold-start wake-ups from `talk_to_agent`.
 */

export type VoiceSessionStatus = "connecting" | "live" | "error";

export interface VoiceSessionState {
  status: VoiceSessionStatus;
  /** X — the agent perspective the session speaks and acts as. */
  fromUsername: string;
  fromTitle: string;
  /** Y — the target agent being operated. */
  targetUsername: string;
  targetTitle: string;
  /** Mode the session was started in — drives the toolset and narration filter. */
  mode: VoiceMode;
  /** Mic is suppressed locally; the call stays connected. */
  muted: boolean;
  /** Running dollar total for this call, summed from each turn's recorded
   *  cost. Server is the source of truth; this is a local mirror for UI. */
  totalCost: number;
  /** Set when status is "error". */
  error?: string;
}

export interface StartVoiceSessionParams {
  fromUsername: string;
  fromTitle: string;
  targetUsername: string;
  targetTitle: string;
  mode: VoiceMode;
}

interface VoiceSessionContextValue {
  session: VoiceSessionState | null;
  startSession: (params: StartVoiceSessionParams) => void;
  hangUp: () => void;
  toggleMute: () => void;
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | undefined>(
  undefined,
);

interface LogTarget {
  runId: number;
  sessionId: number;
  subagentId: number;
}

/** Narrow run shape we track locally — only the fields needed to pick the
 *  most-recently-active run. Avoids depending on the wider RunSession type
 *  (which carries fields like activeSubagentCount that the SessionPush event
 *  doesn't provide). */
interface TrackedRun {
  runId: number;
  sessionId: number;
  subagentId: number;
  lastActive: string;
}

const trackedKey = (r: TrackedRun) =>
  `${r.runId}-${r.subagentId}-${r.sessionId}`;

/** Pick the most-recently-active online run. Returns undefined when nothing
 *  is online — the caller leaves the previous target in place (resilient
 *  against brief gaps during compaction / subagent handoff). */
function pickActiveRun(runs: TrackedRun[]): TrackedRun | undefined {
  return [...runs]
    .sort(
      (a, b) =>
        new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime(),
    )
    .find((r) => isRunActive(r.lastActive));
}

// The `runs:${target}` room emits four event types — we drive logTarget off
// the two session-lifecycle ones and ignore the rest. Match useRunsData's
// shape so future additions to the room are TS-forced into an explicit case.
type RunsRoomEvent =
  | (SessionPush["session"] & { type: "new-session" })
  | (SessionHeartbeatUpdate & {
      type: "heartbeat-update";
      activeSubagentCount: number;
    })
  | (LogPushSessionUpdate & { type: "log-update" })
  | (CostPushEntry & { type: "cost-update" });

export const VoiceSessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [session, setSession] = useState<VoiceSessionState | null>(null);
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);

  // The currently-active voice session object. Each has its own
  // AbortController, so aborting cancels all its in-flight work.
  const sessionRef = useRef<VoiceSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Known runs for the current target, keyed by trackedKey. Maintained off
  // the initial REST snapshot + the runs:${target} socket events; consulted
  // by recomputeLogTarget() to pick the most-recently-active one.
  const runsRef = useRef<Map<string, TrackedRun>>(new Map());

  /** Recompute logTarget against the current runsRef. Called after the
   *  initial snapshot and on every runs:${target} event. Leaves the previous
   *  target in place when nothing is currently active — resilient to brief
   *  gaps during compaction / subagent handoff. */
  const recomputeLogTarget = useCallback(() => {
    const run = pickActiveRun(Array.from(runsRef.current.values()));
    if (!run) return;
    const next: LogTarget = {
      runId: run.runId,
      sessionId: run.sessionId,
      subagentId: run.subagentId,
    };
    setLogTarget((prev) =>
      prev &&
      prev.runId === next.runId &&
      prev.sessionId === next.sessionId &&
      prev.subagentId === next.subagentId
        ? prev
        : next,
    );
  }, []);

  const hangUp = useCallback(() => {
    sessionRef.current?.abort();
    sessionRef.current = null;
    runsRef.current = new Map();
    setLogTarget(null);
    setSession(null);
  }, []);

  const toggleMute = useCallback(() => {
    setSession((s) => {
      if (!s) return s;
      const next = !s.muted;
      sessionRef.current?.setMicMuted(next);
      return { ...s, muted: next };
    });
  }, []);

  const startSession = useCallback(
    (params: StartVoiceSessionParams) => {
      // Replace any existing session. abort() is silent — no onError fires,
      // which is what we want for a user-initiated replace.
      sessionRef.current?.abort();
      sessionRef.current = null;
      runsRef.current = new Map();
      setLogTarget(null);
      setSession({
        status: "connecting",
        fromUsername: params.fromUsername,
        fromTitle: params.fromTitle,
        targetUsername: params.targetUsername,
        targetTitle: params.targetTitle,
        mode: params.mode,
        muted: false,
        totalCost: 0,
      });

      const instance = createVoiceSession(params, {
        getAudioElement: () => audioRef.current,
        // Each callback compares captured `instance` against sessionRef.current.
        // The session already gates on `aborted`; this is the cheap explicit
        // guarantee that a replaced instance can't mutate the new one's state.
        onDisplayResolved: (display: VoiceSessionDisplay) => {
          if (sessionRef.current !== instance) return;
          setSession((s) => (s ? { ...s, ...display } : s));
        },
        onLive: () => {
          if (sessionRef.current !== instance) return;
          setSession((s) => (s ? { ...s, status: "live" } : s));
        },
        onCostRecorded: (cost: number) => {
          if (sessionRef.current !== instance) return;
          setSession((s) =>
            s ? { ...s, totalCost: s.totalCost + cost } : s,
          );
        },
        onError: (reason: string) => {
          if (sessionRef.current !== instance) return;
          sessionRef.current = null;
          setLogTarget(null);
          setSession((s) =>
            s ? { ...s, status: "error", error: reason } : s,
          );
        },
      });
      sessionRef.current = instance;
      void instance.start();

      // Initial runs snapshot — picks up a run that's already running when
      // the voice session opens. Tied to session creation (not a useEffect
      // on session?.status) so a normal connecting → live transition can't
      // wipe runsRef after socket events have already populated it. Gated
      // by `sessionRef.current === instance` so a late-returning fetch
      // can't stomp a replaced session.
      void (async () => {
        try {
          const res = await getRunsData({
            agentUsername: params.targetUsername,
          });
          if (sessionRef.current !== instance) return;
          for (const r of res.data?.runs ?? []) {
            const tracked: TrackedRun = {
              runId: r.runId,
              sessionId: r.sessionId,
              subagentId: r.subagentId ?? 0,
              lastActive: r.lastActive,
            };
            runsRef.current.set(trackedKey(tracked), tracked);
          }
          recomputeLogTarget();
        } catch (error) {
          console.warn("[Voice] could not load runs snapshot:", error);
        }
      })();
    },
    [recomputeLogTarget],
  );

  // Live updates from the runs room — follow new runs (cold-start wake from
  // talk_to_agent, compaction's incremented session_id, subagent handoff)
  // and lastActive bumps that change which run is most-recently-active.
  const handleRunsEvent = useCallback(
    (event: RunsRoomEvent) => {
      // log-update and cost-update arrive on this room too but don't bear
      // on which run we should latch to.
      if (event.type !== "new-session" && event.type !== "heartbeat-update") {
        return;
      }
      // Upsert on both branches: heartbeat-update carries the same id +
      // lastActive fields TrackedRun needs, so it can stand in for a missed
      // new-session (socket reconnect, subscription timing race, brief
      // server/browser gap). Without that recovery, the no-poll design
      // would strand voice on a stale logTarget for the rest of the
      // session — heartbeats fire every few seconds, so latching off them
      // closes the gap fast.
      const tracked: TrackedRun = {
        runId: event.runId,
        sessionId: event.sessionId,
        subagentId: event.subagentId ?? 0,
        lastActive: event.lastActive,
      };
      runsRef.current.set(trackedKey(tracked), tracked);
      recomputeLogTarget();
    },
    [recomputeLogTarget],
  );

  const runsRoom = useMemo(() => {
    if (session?.status !== "live" && session?.status !== "connecting") {
      return null;
    }
    return `runs:${session.targetUsername}`;
  }, [session?.status, session?.targetUsername]);

  useSubscription<RunsRoomEvent>(runsRoom, handleRunsEvent);

  // Forward log entries to the active session; it owns narration timing
  // and decides when (if at all) to give the model a turn.
  const handleLogEntries = useCallback((entries: LogPushEntry[]) => {
    sessionRef.current?.injectLogEntries(entries);
  }, []);

  const logRoom = useMemo(() => {
    if (!session || !logTarget) return null;
    return `logs:${session.targetUsername}:${logTarget.runId}:${logTarget.subagentId}:${logTarget.sessionId}`;
  }, [session, logTarget]);

  useSubscription<LogPushEntry[]>(logRoom, handleLogEntries);

  // Chat-mode only: bridge image attachments on chat messages into the voice
  // narration. Inbound chat to the target agent textifies its attachments
  // (filename + size only), so the image bytes never reach bob's run log;
  // routing the chat-messages broadcast through the same narration path is
  // the only way the voice agent gets to see them. Synthetic LogPushEntry
  // items keep this on the existing buffer/cap/dedup machinery — see
  // voiceChatImages.ts.
  const chatRoom = useMemo(() => {
    if (session?.mode !== "chat") return null;
    return chatMessagesRoomKey([session.fromUsername, session.targetUsername]);
  }, [session?.mode, session?.fromUsername, session?.targetUsername]);

  type ChatRoomEvent =
    | ({ type: "new-message"; previousMessageId: number | null } & MailPush)
    | { type: "read-receipt"; messageIds: number[]; userId: number };

  // Inject image attachments from any participant — both the operator's own
  // sends (they may immediately ask "what's in that screenshot I just
  // attached?") and the target agent's replies. The room is participant-
  // scoped so unrelated traffic doesn't reach this handler.
  const handleChatEvent = useCallback((event: ChatRoomEvent) => {
    if (event.type !== "new-message") return;
    const entries = imagesFromChatMessage(event);
    if (entries.length === 0) return;
    sessionRef.current?.injectLogEntries(entries);
  }, []);

  useSubscription<ChatRoomEvent>(chatRoom, handleChatEvent);

  // Tear any active session down if the provider unmounts.
  useEffect(
    () => () => {
      sessionRef.current?.abort();
      sessionRef.current = null;
    },
    [],
  );

  const value: VoiceSessionContextValue = {
    session,
    startSession,
    hangUp,
    toggleMute,
  };

  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
      {/* Plays the model's audio; positioned off-screen, no controls. */}
      <audio ref={audioRef} autoPlay hidden />
    </VoiceSessionContext.Provider>
  );
};

export const useVoiceSession = (): VoiceSessionContextValue => {
  const context = useContext(VoiceSessionContext);
  if (context === undefined) {
    throw new Error(
      "useVoiceSession must be used within a VoiceSessionProvider",
    );
  }
  return context;
};
