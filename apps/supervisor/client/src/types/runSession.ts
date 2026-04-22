import type { CommandLoopState } from "@naisys/hub-protocol";
import type { RunSession as BaseRunSession } from "@naisys/supervisor-shared";

/**
 * Client-side RunSession type with computed properties
 */
export type RunSession = BaseRunSession & {
  isOnline: boolean;
  paused?: boolean;
  state?: CommandLoopState;
};
