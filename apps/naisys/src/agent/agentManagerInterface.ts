import type { CommandLoopState } from "@naisys/hub-protocol";

/** Don't create a cyclic dependency on agent manager, or give this class access to all of the the agent manager's properties */
export interface IAgentManager {
  startAgent: (
    userId: number,
    onStop?: (reason: string) => void,
    runtimeApiKey?: string,
  ) => Promise<number>;
  stopAgent: (agentUserId: number, reason: string) => Promise<void>;
  stopAll: (reason: string, excludeUserId?: number) => Promise<void>;
  runningAgents: Array<{
    agentUserId: number;
    agentUsername: string;
    agentTitle: string;
    getRunId: () => number;
    getSessionId: () => number;
    isPaused: () => boolean;
    setPaused: (paused: boolean) => boolean;
    getState: () => CommandLoopState;
  }>;
  getBufferLines: (agentUserId: number) => string[];
  setActiveConsoleAgent: (agentUserId: number) => void;
  /** This ensures other agents are immediately notified when an agent goes on/offline. It also helps test run faster */
  onHeartbeatNeeded?: () => void;
}
