import type { LogPushEntry } from "@naisys/hub-protocol";
import { useEffect, useMemo, useRef, useState } from "react";

import { getAgentRunLogEntries } from "../../lib/api/apiRuns";
import { useRoomSubscriptions } from "../socket/useSubscription";
import type { ThreadRun } from "./useMessageThreadRuns";

export interface ThreadRunCommand {
  logId: number;
  username: string;
  runId: number;
  subagentId: number | null;
  sessionId: number;
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
 * `endPrompt` and `llm` log entries for the chat thread, scoped to a bounded
 * set of runs: the top-N latest per participant, every online run (so phantom
 * bubbles always render), and any runs the user has explicitly opened from a
 * divider. Online runs in the loaded set get a socket subscription so fresh
 * commands stream in live.
 */
export function useThreadRunCommands(
  participants: string[],
  runs: ThreadRun[],
  explicitlyLoadedRunIds: Set<number>,
): {
  entries: ThreadRunCommand[];
  loadedRunIds: Set<number>;
} {
  // username → logId → command. Two-level map keeps merging idempotent per id
  // across REST refetches and live socket pushes.
  const [byUser, setByUser] = useState<
    Map<string, Map<number, ThreadRunCommand>>
  >(new Map());
  const [loadedRunIds, setLoadedRunIds] = useState<Set<number>>(new Set());
  const inFlight = useRef<Set<number>>(new Set());
  const generation = useRef(0);

  const participantsKey = useMemo(
    () => participants.slice().sort().join(","),
    [participants],
  );

  // Bumping generation lets in-flight fetches from the prior thread bail out
  // on resolve instead of writing into the new thread's state.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = new Set();
    setByUser(new Map());
    setLoadedRunIds(new Set());
  }, [participantsKey]);

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
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const set = new Set<number>();
      // Distinct runIds, skipping subagent rows that share the parent's runId.
      for (const r of list) {
        if (set.size >= TOP_RUNS_PER_PARTICIPANT) break;
        set.add(r.runId);
      }
      // Online runs always count, even if older than the top N — otherwise
      // long-running runs older than recent activity would lose their phantom.
      for (const r of list) {
        if (r.isOnline) set.add(r.runId);
      }
      target.set(username, set);
    }

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
      if (myGen !== generation.current) return;

      for (const { runIds } of results) {
        runIds.forEach((id) => inFlight.current.delete(id));
      }

      // Only mark successful fetches as loaded. A failed result leaves the run
      // out so a subsequent target-set change (online flip, divider open) will
      // retry it instead of silently hiding its commands. Skip the setter when
      // nothing succeeded so the effect's loadedRunIds dep doesn't change and
      // immediately re-fire a tight retry loop.
      const succeededIds: number[] = [];
      for (const { runIds, result } of results) {
        if (!result?.success) continue;
        succeededIds.push(...runIds);
      }
      if (succeededIds.length > 0) {
        setLoadedRunIds((prev) => {
          const next = new Set(prev);
          for (const id of succeededIds) next.add(id);
          return next;
        });
      }

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

  // Live commands. The `logs:...` room key is per-session/subagent, so a run
  // with multiple sessions or subagents needs one subscription per row.
  const subscriptionEntries = useMemo(() => {
    const out: Array<{
      room: string;
      onMessage: (entries: LogPushEntry[]) => void;
    }> = [];
    for (const run of runs) {
      if (!run.isOnline || !run.username) continue;
      if (!targetByUser.get(run.username)?.has(run.runId)) continue;
      const username = run.username;
      const runId = run.runId;
      const subagentId = run.subagentId ?? null;
      const sessionId = run.sessionId;
      out.push({
        room: subscriptionRoom(username, runId, subagentId, sessionId),
        onMessage: (entries) => {
          const newEntries = entries
            .filter((e) => e.source === "endPrompt" || e.source === "llm")
            .map<ThreadRunCommand>((e) => ({
              logId: e.id,
              username,
              runId,
              subagentId,
              sessionId,
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
        },
      });
    }
    return out;
  }, [runs, targetByUser]);

  useRoomSubscriptions<LogPushEntry[]>(subscriptionEntries);

  const entries = useMemo(() => {
    const flat: ThreadRunCommand[] = [];
    for (const userMap of byUser.values()) {
      for (const cmd of userMap.values()) flat.push(cmd);
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
