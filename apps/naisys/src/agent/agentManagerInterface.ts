/** Don't create a cyclic dependency on agent manager, or give this class access to all of the the agent manager's properties */
export interface IAgentManager {
  startAgent: (
    userId: number,
    onStop?: (reason: string) => void,
  ) => Promise<number>;
  stopAgent: (
    agentUserId: number,
    mode: "requestShutdown" | "completeShutdown",
    reason: string,
  ) => Promise<void>;
  runningAgents: Array<{
    agentUserId: number;
    agentUsername: string;
    agentTitle: string;
  }>;
  getBufferLineCount: (agentUserId: number) => number;
  setActiveConsoleAgent: (agentUserId: number) => void;
  /** This ensures other agents are immediately notified when an agent goes on/offline. It also helps test run faster */
  onHeartbeatNeeded?: () => void;
}
