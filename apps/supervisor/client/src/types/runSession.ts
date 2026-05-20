import type { CommandLoopState } from "@naisys/hub-protocol";
import type { RunSession as BaseRunSession } from "@naisys/supervisor-shared";

/**
 * Client-side RunSession type. paused/state are folded in from heartbeat
 * events — the REST payload doesn't carry them.
 */
export type RunSession = BaseRunSession & {
  paused?: boolean;
  state?: CommandLoopState;
};
