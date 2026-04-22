import type { CommandLoopState } from "@naisys/hub-protocol";

/**
 * Tracks what the command loop is currently blocking on. The loop calls
 * `setState` before each significant hold; between holds the last-set value
 * is stale but brief. The onChange callback fires an immediate heartbeat so
 * supervisors see transitions without waiting for the next interval tick.
 */
export function createCommandLoopState(onChange?: () => void) {
  let state: CommandLoopState = "Initializing";

  function setState(next: CommandLoopState) {
    if (state === next) {
      return;
    }
    state = next;
    onChange?.();
  }

  function getState() {
    return state;
  }

  return {
    setState,
    getState,
  };
}

export type CommandLoopStateService = ReturnType<typeof createCommandLoopState>;
