import { DatabaseService } from "@naisys/database";
import { GlobalConfig } from "../globalConfig.js";
import { HubSyncClient } from "../hub/hubSyncClient.js";
import { RemoteAgentRequester } from "../hub/remoteAgentRequester.js";
import { HostService } from "../services/hostService.js";
import { OutputColor } from "../utils/output.js";
import { AgentRuntime, createAgentRuntime } from "./agentRuntime.js";

/** Handles the multiplexing of multiple concurrent agents in the process */
export class AgentManager {
  runningAgents: AgentRuntime[] = [];
  runLoops: Promise<void>[] = [];

  constructor(
    private dbService: DatabaseService,
    private globalConfig: GlobalConfig,
    private hostService: HostService,
    private remoteAgentRequester: RemoteAgentRequester,
    private hubSyncClient: HubSyncClient,
  ) {}

  async startAgent(userId: string, onStop?: (reason: string) => void) {
    // Check if agent is already running
    const existing = this.runningAgents.find((a) => a.agentUserId === userId);
    if (existing) {
      throw new Error(`Agent '${existing.agentUsername}' is already running`);
    }

    const agent = await createAgentRuntime(
      this,
      userId,
      this.dbService,
      this.globalConfig,
      this.hostService,
      this.remoteAgentRequester,
      this.hubSyncClient,
    );

    this.runningAgents.push(agent);

    if (this.runningAgents.length === 1) {
      this.setActiveConsoleAgent(agent.agentUserId);
    }

    let stopReason = "";

    agent
      .runCommandLoop()
      .then(() => {
        stopReason = "completed";
      })
      .catch((ex: any) => {
        stopReason = `error: ${ex}`;
      })
      .finally(async () => {
        // Notify subagent manager that this agent has stopped
        onStop?.(stopReason);

        await this.stopAgent(
          agent.agentUserId,
          "completeShutdown",
          `${agent.agentUsername} shutdown`,
        );
      });

    return agent.agentUserId;
  }

  async stopAgent(
    agentUserId: string,
    stage: "completeShutdown" | "requestShutdown",
    reason: string,
  ) {
    const agent = this.runningAgents.find((a) => a.agentUserId === agentUserId);

    if (!agent) {
      if (stage == "requestShutdown") {
        throw new Error(`Agent with user ID ${agentUserId} not found`);
      }
      // Else the function was probably called from the finally block above triggered by the shutdown below
      return;
    }

    if (agent.output.isConsoleEnabled()) {
      const switchToAgent = this.runningAgents.find((a) => a !== agent);

      if (switchToAgent) {
        this.setActiveConsoleAgent(switchToAgent.agentUserId);
      }
    }

    if (stage == "requestShutdown") {
      // Use abort controller to gracefully stop the agent, whcih should trigger the finally block above
      await agent.requestShutdown(reason);
    }

    if (stage == "completeShutdown") {
      const agentIndex = this.runningAgents.findIndex((a) => a === agent);
      this.runningAgents.splice(agentIndex, 1);

      agent.completeShutdown(reason);
    }
  }

  async stopAgentByUserId(userId: string, reason: string) {
    // Find the running agent by userId
    const agent = this.runningAgents.find((a) => a.agentUserId === userId);
    if (!agent) {
      throw new Error(`Agent with user ID '${userId}' is not running`);
    }

    await this.stopAgent(agent.agentUserId, "requestShutdown", reason);
  }

  setActiveConsoleAgent(userId: string) {
    const newActiveAgent = this.runningAgents.find(
      (a) => a.agentUserId === userId,
    );

    if (!newActiveAgent) {
      throw new Error(`Agent with user ID ${userId} not found`);
    }

    if (newActiveAgent.output.isConsoleEnabled()) {
      throw new Error(`Agent with user ID ${userId} is already active`);
    }

    const prevActiveAgent = this.runningAgents.find((a) =>
      a.output.isConsoleEnabled(),
    );

    if (prevActiveAgent) {
      // Last output from the previously active agent
      prevActiveAgent.output.write(
        `Switching to agent ${newActiveAgent.agentUsername}`,
        OutputColor.subagent,
      );
      prevActiveAgent.output.setConsoleEnabled(false);
    }

    // Enable console for the active agent, disable for others
    newActiveAgent.output.setConsoleEnabled(true);

    // This switch event is used to break the input prompt timeout of the newly active agent
    if (prevActiveAgent) {
      newActiveAgent.subagentService.raiseSwitchEvent();
    }
  }

  getBufferLines(userId: string) {
    const agent = this.runningAgents.find((a) => a.agentUserId === userId);

    if (!agent) {
      return 0;
    }

    return agent.output.consoleBuffer.length;
  }

  async waitForAllAgentsToComplete() {
    // Poll every second to see if there are running agents
    while (this.runningAgents.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
