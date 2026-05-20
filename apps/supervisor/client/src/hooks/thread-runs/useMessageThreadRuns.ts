import { useCallback, useMemo } from "react";

import { getMessageThreadRuns } from "../../lib/api/apiRuns";
import type { RunSession } from "../../types/runSession";
import { useLiveRuns } from "../data/useLiveRuns";
import { useSubscription } from "../socket/useSubscription";

/** A run that has participated in a chat or mail thread. */
export type ThreadRun = RunSession;

/**
 * Runs that have actually participated in this chat or mail thread, derived
 * from `mail_recipients.read_run_id` — runs the agent ran outside the thread
 * (admin, other-kind messages, fire-and-forget tasks) are filtered out.
 *
 * Loaded runs are kept live (online/offline, paused) from their `runs:` rooms.
 * A run joins the thread only by reading or sending a thread message, so the
 * thread's message room — not run heartbeats — drives the set as it grows.
 */
export const useMessageThreadRuns = (
  kind: "chat" | "mail",
  currentAgentUsername: string,
  participants: string[],
) => {
  // Matches mail_messages.participants and the relevant socket room key.
  const participantsKey = useMemo(
    () => participants.slice().sort().join(","),
    [participants],
  );
  const enabled = !!participantsKey && !!currentAgentUsername;

  const fetchPage = useCallback(async () => {
    if (!enabled) return null;
    const result = await getMessageThreadRuns({
      kind,
      agentUsername: currentAgentUsername,
      participants: participantsKey,
    });
    if (result.success && result.data) {
      return { runs: result.data.runs, total: result.data.runs.length };
    }
    return null;
  }, [enabled, kind, currentAgentUsername, participantsKey]);

  // `pullNewRuns` is off — the message room (below) already refetches when a
  // run joins the thread, and a participant's unrelated runs must not trigger
  // refetches just for sharing its `runs:` room.
  const { runs, isLoading, patchRun, refetch } = useLiveRuns({
    resetKey: enabled
      ? `thread:${kind}:${currentAgentUsername}:${participantsKey}`
      : null,
    fetchPage,
  });

  // new-message and read-receipt can both widen the participating-run set (a
  // fresh sender or reader's run_id), so refetch on any message event. Chat
  // broadcasts per-thread (`chat-messages:{participants}`); mail broadcasts
  // per-user inbox (`mail:{username}`) — same trigger either way.
  const messageRoom = useMemo(() => {
    if (!enabled) return null;
    return kind === "chat"
      ? `chat-messages:${participantsKey}`
      : `mail:${currentAgentUsername}`;
  }, [enabled, kind, participantsKey, currentAgentUsername]);

  useSubscription<unknown>(messageRoom, refetch);

  return { runs, isLoading, patchRun };
};
