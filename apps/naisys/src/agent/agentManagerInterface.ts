import type { CommandLoopState } from "@naisys/hub-protocol";

import type { CostTracker } from "../llm/costTracker.js";
import type { NaisysApiService } from "../services/hub/naisysApiService.js";

/** When set, the agent runs as a local-only ephemeral child of the parent. */
export interface SubagentContext {
  parentUserId: number;
  parentRunId: number;
  subagentId: number;
  parentCostTracker: CostTracker;
}

/** shellModel is returned so the AGENT_START ack can hand it back to the
 * hub to fill in the run_session row's model_name. */
export interface AgentStartedInfo {
  agentUserId: number;
  shellModel: string;
}

/** Don't create a cyclic dependency on agent manager, or give this class access to all of the the agent manager's properties */
export interface IAgentManager {
  startAgent: (
    userId: number,
    runtimeApiKey?: string,
    onStop?: (reason: string) => void,
    subagentContext?: SubagentContext,
    preallocated?: { runId: number; sessionId: number },
  ) => Promise<AgentStartedInfo>;
  stopAgent: (agentUserId: number, reason: string) => Promise<void>;
  stopAll: (reason: string, excludeUserId?: number) => Promise<void>;
  runningAgents: Array<{
    agentUserId: number;
    /** Set when this is a subagent — used to cascade parent pause/resume. */
    parentUserId?: number;
    agentUsername: string;
    agentTitle: string;
    shellModel: string;
    getRunId: () => number;
    getSessionId: () => number;
    isPaused: () => boolean;
    setPaused: (paused: boolean) => boolean;
    getState: () => CommandLoopState;
    naisysApiService: NaisysApiService;
  }>;
  getBufferLines: (agentUserId: number) => string[];
  setActiveConsoleAgent: (agentUserId: number) => void;
  /** This ensures other agents are immediately notified when an agent goes on/offline. It also helps test run faster */
  onHeartbeatNeeded?: () => void;
}
