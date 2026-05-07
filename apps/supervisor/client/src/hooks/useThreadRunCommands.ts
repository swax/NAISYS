import type { LogPushEntry } from "@naisys/hub-protocol";
import { useEffect, useMemo, useRef, useState } from "react";

import { getAgentRunLogEntries } from "../lib/apiRuns";
import { getSocket } from "./useSocket";
import type { ThreadRun } from "./useThreadRuns";

export interface ThreadRunCommand {
  logId: number;
  username: string;
  runId: number;
  subagentId: number | null;
  sessionId: number;
  source: "endPrompt" | "llm";
  message: string;
  createdAt: string;
}

const TOP_RUNS_PER_PARTICIPANT = 3;
const COMMAND_SOURCES: Array<"endPrompt" | "llm"> = ["endPrompt", "llm"];

const subscriptionRoom = (
  username: string,
  runId: number,
  subagentId: number | null | undefined,
  sessionId: number,
) => `logs:${username}:${runId}:${subagentId ?? 0}:${sessionId}`;

/**
 * Fetches `endPrompt` and `llm` log entries for the chat thread, scoped to a
 * bounded set of runs rather than a time window. The set is the auto-loaded
 * top-N latest runs per participant, plus any online runs (so phantom bubbles
 * always render), plus runs the user has explicitly opened from a divider.
 *
 * Online runs in the loaded set additionally get a socket subscription so
 * fresh commands stream in live.
 */
export function useThreadRunCommands(
  participants: string[],
  runs: ThreadRun[],
  explicitlyLoadedRunIds: Set<number>,
): {
  entries: ThreadRunCommand[];
  loadedRunIds: Set<number>;
} {
  // Outer key = username; inner key = logId. Two-level map keeps merging
  // (REST refetch + live socket pushes) idempotent per id without rescanning.
  const [byUser, setByUser] = useState<
    Map<string, Map<number, ThreadRunCommand>>
  >(new Map());

  // RunIds we've successfully fetched (or are fetching). Used to skip
  // refetching the same run twice and to drive the divider button state.
  const [loadedRunIds, setLoadedRunIds] = useState<Set<number>>(new Set());
  const inFlight = useRef<Set<number>>(new Set());
  const generation = useRef(0);

  const participantsKey = useMemo(
    () => participants.slice().sort().join(","),
    [participants],
  );

  // Reset state on participants change. Bumps generation so any in-flight
  // promises from the prior thread are ignored on resolve.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = new Set();
    setByUser(new Map());
    setLoadedRunIds(new Set());
  }, [participantsKey]);

  // For each participant, the runIds we want loaded right now: top-N most
  // recent runs (by createdAt), plus every online run, plus explicitly loaded.
  const targetByUser = useMemo(() => {
    const target = new Map<string, Set<number>>();
    if (participants.length === 0) return target;

    const runsByUser = new Map<string, ThreadRun[]>();
    for (const r of runs) {
      if (!r.username) continue;
      const list = runsByUser.get(r.username) ?? [];
      list.push(r);
      runsByUser.set(r.username, list);
    }

    for (const username of participants) {
      const list = runsByUser.get(username) ?? [];
      // Most-recently-started first. Distinct runIds across sessions.
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const set = new Set<number>();
      for (const r of list) {
        if (set.size >= TOP_RUNS_PER_PARTICIPANT) break;
        set.add(r.runId);
      }
      // Online runs always count, even if older than the top N.
      for (const r of list) {
        if (r.isOnline) set.add(r.runId);
      }
      target.set(username, set);
    }

    // Explicitly loaded — find which participant owns each runId.
    if (explicitlyLoadedRunIds.size > 0) {
      const ownerByRunId = new Map<number, string>();
      for (const r of runs) {
        if (r.username && !ownerByRunId.has(r.runId)) {
          ownerByRunId.set(r.runId, r.username);
        }
      }
      for (const runId of explicitlyLoadedRunIds) {
        const owner = ownerByRunId.get(runId);
        if (!owner) continue;
        const set = target.get(owner) ?? new Set();
        set.add(runId);
        target.set(owner, set);
      }
    }

    return target;
  }, [participants, runs, explicitlyLoadedRunIds]);

  // Fetch any newly-targeted runs. Existing entries are kept on the merge so
  // live-pushed commands aren't clobbered.
  useEffect(() => {
    if (targetByUser.size === 0) return;

    const myGen = generation.current;
    const fetchesByUser: Array<{ username: string; runIds: number[] }> = [];

    for (const [username, runIds] of targetByUser) {
      const toFetch = [...runIds].filter(
        (id) => !inFlight.current.has(id) && !loadedRunIds.has(id),
      );
      if (toFetch.length === 0) continue;
      toFetch.forEach((id) => inFlight.current.add(id));
      fetchesByUser.push({ username, runIds: toFetch });
    }

    if (fetchesByUser.length === 0) return;

    void Promise.all(
      fetchesByUser.map(({ username, runIds }) =>
        getAgentRunLogEntries({
          agentUsername: username,
          runIds,
          sources: COMMAND_SOURCES,
        })
          .then((result) => ({ username, runIds, result }))
          .catch(() => ({ username, runIds, result: null })),
      ),
    ).then((results) => {
      // Bail if the participants changed mid-flight.
      if (myGen !== generation.current) return;

      for (const { runIds } of results) {
        runIds.forEach((id) => inFlight.current.delete(id));
      }

      setLoadedRunIds((prev) => {
        const next = new Set(prev);
        for (const { runIds } of results) {
          runIds.forEach((id) => next.add(id));
        }
        return next;
      });

      setByUser((prev) => {
        const next = new Map(prev);
        for (const { username, result } of results) {
          if (!result?.success || !result.data) continue;
          const merged = new Map(next.get(username) ?? []);
          for (const e of result.data.entries) {
            merged.set(e.logId, {
              logId: e.logId,
              username,
              runId: e.runId,
              subagentId: e.subagentId ?? null,
              sessionId: e.sessionId,
              source: e.source as "endPrompt" | "llm",
              message: e.message,
              createdAt: e.createdAt,
            });
          }
          next.set(username, merged);
        }
        return next;
      });
    });
  }, [targetByUser, loadedRunIds]);

  // Live subscriptions: subscribe to every online run that's in the target
  // set. The room key includes session + subagent, so a long-running run with
  // multiple sessions or subagents needs one sub per session row.
  const onlineSubKey = useMemo(() => {
    const keys: string[] = [];
    for (const r of runs) {
      if (!r.isOnline || !r.username) continue;
      const userTarget = targetByUser.get(r.username);
      if (!userTarget?.has(r.runId)) continue;
      keys.push(
        `${r.username}|${r.runId}|${r.subagentId ?? 0}|${r.sessionId}`,
      );
    }
    return keys.sort().join(",");
  }, [runs, targetByUser]);

  useEffect(() => {
    const onlineRows = runs.filter((r) => {
      if (!r.isOnline || !r.username) return false;
      return targetByUser.get(r.username)?.has(r.runId) ?? false;
    });
    if (onlineRows.length === 0) return;

    const socket = getSocket();
    const cleanups: Array<() => void> = [];

    for (const run of onlineRows) {
      const username = run.username as string;
      const room = subscriptionRoom(
        username,
        run.runId,
        run.subagentId,
        run.sessionId,
      );

      const subscribe = () => socket.emit("subscribe", { room });
      subscribe();

      const handler = (entries: LogPushEntry[]) => {
        const newEntries = entries
          .filter(
            (e): e is LogPushEntry & { source: "endPrompt" | "llm" } =>
              e.source === "endPrompt" || e.source === "llm",
          )
          .map<ThreadRunCommand>((e) => ({
            logId: e.id,
            username,
            runId: run.runId,
            subagentId: run.subagentId ?? null,
            sessionId: run.sessionId,
            source: e.source,
            message: e.message,
            createdAt: e.createdAt,
          }));
        if (newEntries.length === 0) return;

        setByUser((prev) => {
          const next = new Map(prev);
          const merged = new Map(next.get(username) ?? []);
          for (const e of newEntries) merged.set(e.logId, e);
          next.set(username, merged);
          return next;
        });
      };

      socket.on(room, handler);
      socket.on("connect", subscribe);
      cleanups.push(() => {
        socket.off(room, handler);
        socket.off("connect", subscribe);
        socket.emit("unsubscribe", { room });
      });
    }

    return () => {
      for (const c of cleanups) c();
    };
  }, [onlineSubKey]);

  const entries = useMemo(() => {
    const flat: ThreadRunCommand[] = [];
    for (const userMap of byUser.values()) {
      for (const ep of userMap.values()) flat.push(ep);
    }
    flat.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.logId - b.logId,
    );
    return flat;
  }, [byUser]);

  return { entries, loadedRunIds };
}
