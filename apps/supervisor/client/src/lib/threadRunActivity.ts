import { addToSetMap, maxBy, sortBy } from "@naisys/common";

import type { ThreadRun } from "../hooks/thread-runs/useMessageThreadRuns";

export type RunEventType = "start" | "stop";

type RunEvent = {
  type: RunEventType;
  username: string;
  runId: number;
  time: string;
};

export type RunActivityEntry = {
  username: string;
  type: RunEventType;
  time: string;
  /** Distinct runIds for this user whose start/stop fell into the cluster. */
  runIds: number[];
};

export type RunActivity = {
  perUser: RunActivityEntry[];
  latestTime: string;
};

export type ThreadRunActivity = {
  beforeMessage: Map<number, RunActivity>;
  trailing: RunActivity | null;
};

const EMPTY: ThreadRunActivity = {
  beforeMessage: new Map(),
  trailing: null,
};

/**
 * Group start/stop events into clusters bracketed by messages. Each cluster
 * collapses to one entry per user (their latest event in the gap).
 */
export function buildThreadRunActivity(
  messages: Array<{ id: number; createdAt: string }>,
  runs: ThreadRun[],
): ThreadRunActivity {
  if (messages.length === 0 || runs.length === 0) return EMPTY;

  const sortedMsgs = sortBy(messages, (msg) => new Date(msg.createdAt));
  const oldestMsgTime = new Date(sortedMsgs[0].createdAt).getTime();

  const events: RunEvent[] = [];
  for (const run of runs) {
    if (!run.username) continue;
    // collapseCluster keeps the latest event per user — letting a subagent
    // stop in would surface as the parent stopping.
    if (run.subagentId != null) continue;

    const startMs = new Date(run.createdAt).getTime();
    if (startMs >= oldestMsgTime) {
      events.push({
        type: "start",
        username: run.username,
        runId: run.runId,
        time: run.createdAt,
      });
    }

    if (!run.isOnline) {
      const stopMs = new Date(run.lastActive).getTime();
      if (stopMs >= oldestMsgTime) {
        events.push({
          type: "stop",
          username: run.username,
          runId: run.runId,
          time: run.lastActive,
        });
      }
    }
  }

  if (events.length === 0) return EMPTY;

  const sortedEvents = sortBy(events, (event) => new Date(event.time));

  const beforeMessage = new Map<number, RunActivity>();
  let trailing: RunActivity | null = null;
  let eventIdx = 0;

  for (const msg of sortedMsgs) {
    const msgMs = new Date(msg.createdAt).getTime();
    const cluster: RunEvent[] = [];
    while (
      eventIdx < sortedEvents.length &&
      new Date(sortedEvents[eventIdx].time).getTime() <= msgMs
    ) {
      cluster.push(sortedEvents[eventIdx]);
      eventIdx++;
    }
    const activity = collapseCluster(cluster);
    if (activity) beforeMessage.set(msg.id, activity);
  }

  if (eventIdx < sortedEvents.length) {
    trailing = collapseCluster(sortedEvents.slice(eventIdx));
  }

  return { beforeMessage, trailing };
}

function collapseCluster(cluster: RunEvent[]): RunActivity | null {
  if (cluster.length === 0) return null;

  // Cluster is chronological; later events overwrite earlier ones per user
  // for the displayed entry. RunIds, however, accumulate.
  const perUser = new Map<
    string,
    { username: string; type: RunEventType; time: string }
  >();
  const runIdsByUser = new Map<string, Set<number>>();
  for (const event of cluster) {
    perUser.set(event.username, {
      username: event.username,
      type: event.type,
      time: event.time,
    });
    addToSetMap(runIdsByUser, event.username, event.runId);
  }
  const latestTime =
    maxBy(cluster, (event) => new Date(event.time))?.time ?? cluster[0].time;

  const entries: RunActivityEntry[] = Array.from(perUser.values())
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((e) => ({
      ...e,
      runIds: Array.from(runIdsByUser.get(e.username) ?? []),
    }));
  return { perUser: entries, latestTime };
}
