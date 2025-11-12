/**
 * Utility functions for agent-related operations
 */

export const ONLINE_THRESHOLD_SECONDS = 5;

/**
 * Determines if an agent is considered online based on their last active timestamp
 * @param lastActive - ISO timestamp string of when the agent was last active
 * @param dataUpdatedAt - Timestamp (ms) of when the data was last fetched from server
 * @returns true if the agent was active within the last 5 seconds
 */
export function isAgentOnline(lastActive?: string, dataUpdatedAt?: number): boolean {
  if (!lastActive) {
    return false;
  }
  const now = dataUpdatedAt ?? Date.now();
  const lastActiveDate = new Date(lastActive);
  const diffInSeconds = (now - lastActiveDate.getTime()) / 1000;
  return 0 < diffInSeconds && diffInSeconds < (ONLINE_THRESHOLD_SECONDS * 2);
}
