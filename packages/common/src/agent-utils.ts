import {
  HOST_ONLINE_THRESHOLD_MS,
  USER_ONLINE_THRESHOLD_MS,
} from "./thresholds.js";

/**
 * Determines if an agent/user is considered online based on their last active timestamp
 * @param lastActive - ISO timestamp string or Date of when the agent was last active
 * @param referenceTime - Reference time in ms to compare against (defaults to Date.now())
 * @returns true if the agent was active within the threshold
 */
export function isAgentOnline(
  lastActive?: string | Date,
  referenceTime?: number
): boolean {
  if (!lastActive) {
    return false;
  }
  const now = referenceTime ?? Date.now();
  const lastActiveTime =
    typeof lastActive === "string"
      ? new Date(lastActive).getTime()
      : lastActive.getTime();
  const diffInMs = now - lastActiveTime;
  return 0 < diffInMs && diffInMs < USER_ONLINE_THRESHOLD_MS;
}

/**
 * Determines if a host is considered online based on its last active timestamp
 * @param lastActive - ISO timestamp string or Date of when the host was last active
 * @param referenceTime - Reference time in ms to compare against (defaults to Date.now())
 * @returns true if the host was active within the threshold
 */
export function isHostOnline(
  lastActive?: string | Date,
  referenceTime?: number
): boolean {
  if (!lastActive) {
    return false;
  }
  const now = referenceTime ?? Date.now();
  const lastActiveTime =
    typeof lastActive === "string"
      ? new Date(lastActive).getTime()
      : lastActive.getTime();
  const diffInMs = now - lastActiveTime;
  return 0 < diffInMs && diffInMs < HOST_ONLINE_THRESHOLD_MS;
}
