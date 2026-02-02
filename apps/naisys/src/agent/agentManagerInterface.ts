/** Don't create a cyclic dependency on agent manager, or give this class access to all of the the agent manager's properties */
export interface IAgentManager {
  startAgent: (
    userId: string,
    onStop?: (reason: string) => void,
  ) => Promise<string>;
  stopAgent: (
    agentUserId: string,
    mode: "requestShutdown" | "completeShutdown",
    reason: string,
  ) => Promise<void>;
  runningAgents: Array<{
    agentUserId: string;
    agentUsername: string;
    agentTitle: string;
  }>;
  getBufferLineCount: (agentUserId: string) => number;
  setActiveConsoleAgent: (agentUserId: string) => void;
}
