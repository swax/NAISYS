/**
 * Utility functions for agent-related operations
 */

/**
 * Determines if an agent is considered online based on their last active timestamp
 * @param lastActive - ISO timestamp string of when the agent was last active
 * @returns true if the agent was active within the last 5 seconds
 */
export function isAgentOnline(lastActive: string): boolean {
  const now = new Date();
  const lastActiveDate = new Date(lastActive);
  const diffInSeconds = (now.getTime() - lastActiveDate.getTime()) / 1000;
  return 0 < diffInSeconds && diffInSeconds < 5;
}
