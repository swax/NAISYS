/** A run session is considered active if its lastActive heartbeat arrived
 * within this window. The NAISYS → hub → supervisor chain pushes every 2s,
 * so 8s tolerates one missed heartbeat without flipping offline. */
export const RUN_ACTIVE_THRESHOLD_MS = 8_000;

export function isRunActive(lastActive?: string): boolean {
  if (!lastActive) return false;
  const diffInMs = Date.now() - new Date(lastActive).getTime();
  // diffInMs may be negative if the server clock is slightly ahead of the
  // browser clock — that just means the heartbeat arrived very recently, so
  // treat any lastActive newer than the threshold as online.
  return diffInMs < RUN_ACTIVE_THRESHOLD_MS;
}
