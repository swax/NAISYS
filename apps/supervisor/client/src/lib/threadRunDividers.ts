import type { ThreadRun } from "../hooks/useThreadRuns";

export type RunEventType = "start" | "stop";

type RunEvent = {
  type: RunEventType;
  username: string;
  time: string;
};

export type RunDividerEntry = {
  username: string;
  type: RunEventType;
  time: string;
};

export type RunDivider = {
  perUser: RunDividerEntry[];
  latestTime: string;
};

export type ThreadDividers = {
  beforeMessage: Map<number, RunDivider>;
  trailing: RunDivider | null;
};

const EMPTY_DIVIDERS: ThreadDividers = {
  beforeMessage: new Map(),
  trailing: null,
};

/**
 * Group run events into clusters bracketed by messages. Each cluster collapses
 * to one divider showing the latest event per user — matches the "show only
 * the latest start, combine adjacent users" rule.
 */
export function buildThreadDividers(
  messages: Array<{ id: number; createdAt: string }>,
  runs: ThreadRun[],
): ThreadDividers {
  if (messages.length === 0 || runs.length === 0) return EMPTY_DIVIDERS;

  const sortedMsgs = [...messages].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const oldestMsgTime = new Date(sortedMsgs[0].createdAt).getTime();

  const events: RunEvent[] = [];
  for (const run of runs) {
    if (!run.username) continue;

    const startMs = new Date(run.createdAt).getTime();
    if (startMs >= oldestMsgTime) {
      events.push({
        type: "start",
        username: run.username,
        time: run.createdAt,
      });
    }

    if (!run.isOnline) {
      const stopMs = new Date(run.lastActive).getTime();
      if (stopMs >= oldestMsgTime) {
        events.push({
          type: "stop",
          username: run.username,
          time: run.lastActive,
        });
      }
    }
  }

  if (events.length === 0) return EMPTY_DIVIDERS;

  events.sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );

  const beforeMessage = new Map<number, RunDivider>();
  let trailing: RunDivider | null = null;
  let eventIdx = 0;

  for (const msg of sortedMsgs) {
    const msgMs = new Date(msg.createdAt).getTime();
    const cluster: RunEvent[] = [];
    while (
      eventIdx < events.length &&
      new Date(events[eventIdx].time).getTime() <= msgMs
    ) {
      cluster.push(events[eventIdx]);
      eventIdx++;
    }
    const divider = collapseCluster(cluster);
    if (divider) beforeMessage.set(msg.id, divider);
  }

  if (eventIdx < events.length) {
    trailing = collapseCluster(events.slice(eventIdx));
  }

  return { beforeMessage, trailing };
}

function collapseCluster(cluster: RunEvent[]): RunDivider | null {
  if (cluster.length === 0) return null;

  // Cluster is already in chronological order; later events overwrite earlier
  // ones for the same user.
  const perUser = new Map<string, RunDividerEntry>();
  let latestTime = cluster[0].time;
  for (const event of cluster) {
    perUser.set(event.username, {
      username: event.username,
      type: event.type,
      time: event.time,
    });
    if (new Date(event.time).getTime() > new Date(latestTime).getTime()) {
      latestTime = event.time;
    }
  }

  const entries = Array.from(perUser.values()).sort((a, b) =>
    a.username.localeCompare(b.username),
  );
  return { perUser: entries, latestTime };
}
