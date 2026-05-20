import type {
  CostPushEntry,
  LogPushSessionUpdate,
  SessionHeartbeatUpdate,
} from "@naisys/hub-protocol";

import type { RunSession } from "../../types/runSession";

/** Liveness heartbeat for one run, as relayed into a `runs:${username}` room. */
export type RunsHeartbeatUpdate = SessionHeartbeatUpdate & {
  type: "heartbeat-update";
  activeSubagentCount: number;
  online: boolean;
};
/** Log-line delta for one run. */
export type RunsLogUpdate = LogPushSessionUpdate & { type: "log-update" };
/** Cost delta for one run. */
export type RunsCostUpdate = CostPushEntry & { type: "cost-update" };

/** Anything pushed to a `runs:${username}` room. */
export type RunsEvent = RunsHeartbeatUpdate | RunsLogUpdate | RunsCostUpdate;

/** Stable identity for a run row — a subagent row is distinct from its parent. */
export const runKey = (run: {
  userId: number;
  runId: number;
  subagentId?: number | null;
  sessionId: number;
}): string =>
  `${run.userId}-${run.runId}-${run.subagentId ?? 0}-${run.sessionId}`;

/**
 * Apply one `runs:` room event to the run it targets, returning the patched
 * run. Heartbeats carry liveness plus paused/state; log and cost events fold
 * deltas onto the running totals. The caller locates `run` by {@link runKey}.
 */
export function applyRunsEvent(
  run: RunSession,
  event: RunsEvent,
): RunSession {
  switch (event.type) {
    case "heartbeat-update":
      return {
        ...run,
        lastActive: event.lastActive,
        isOnline: event.online,
        activeSubagentCount: event.activeSubagentCount,
        paused: event.paused,
        state: event.state,
        totalTokens: event.totalTokens ?? run.totalTokens,
      };
    case "log-update":
      return {
        ...run,
        lastActive: event.lastActive,
        latestLogId: event.latestLogId,
        totalLines: run.totalLines + event.totalLinesDelta,
      };
    case "cost-update":
      return {
        ...run,
        totalCost: run.totalCost + event.costDelta,
      };
  }
}
