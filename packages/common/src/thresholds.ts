/**
 * Threshold for considering a host online (10 seconds = 5s worst case x2 margin)
 */
export const HOST_ONLINE_THRESHOLD_MS = 10 * 1000;

/**
 * Threshold for considering a user/agent online (16 seconds).
 * Worst-case propagation delay: agent update (2s) + hub sync (1s) + UI refetch (5s) = 8s
 * We use 2x safety factor to avoid flickering from timing alignment or network delays.
 */
export const USER_ONLINE_THRESHOLD_MS = 8 * 2 * 1000;
