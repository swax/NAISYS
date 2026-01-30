/** Don't create a cyclic dependency on agent runner, or give this class access to all of the the agent runner's properties */
export interface IAgentRunner {
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
    agentTaskDescription?: string;
  }>;
  getBufferLines: (agentUserId: string) => number;
  setActiveConsoleAgent: (agentUserId: string) => void;
}
