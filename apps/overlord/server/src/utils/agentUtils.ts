/**
 * Utility functions for agent-related operations
 */

export const ONLINE_THRESHOLD_SECONDS = 5;

/**
 * Determines if an agent is considered online based on their last active timestamp
 * @param lastActive - ISO timestamp string of when the agent was last active
 * @returns true if the agent was active within the last 5 seconds
 */
export function isAgentOnline(lastActiveDate?: Date): boolean {
  if (!lastActiveDate) {
    return false;
  }
  const now = new Date();
  const diffInSeconds = (now.getTime() - lastActiveDate.getTime()) / 1000;
  return 0 < diffInSeconds && diffInSeconds < ONLINE_THRESHOLD_SECONDS;
}
