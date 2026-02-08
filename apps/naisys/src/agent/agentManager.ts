import { adminUserId } from "@naisys/common";
import {
  AgentStartRequestSchema,
  AgentStartResponse,
  AgentStopRequestSchema,
  AgentStopResponse,
  HubEvents,
} from "@naisys/hub-protocol";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";
import { HostService } from "../services/hostService.js";
import { OutputColor } from "../utils/output.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";
import { AgentRuntime, createAgentRuntime } from "./agentRuntime.js";
import { UserService } from "./userService.js";

/** Handles the multiplexing of multiple concurrent agents in the process */
export class AgentManager {
  runningAgents: AgentRuntime[] = [];
  runLoops: Promise<void>[] = [];
  onHeartbeatNeeded?: () => void;

  constructor(
    private globalConfig: GlobalConfig,
    private hubClient: HubClient | undefined,
    private hostService: HostService,
    private userService: UserService,
    private promptNotification: PromptNotificationService,
  ) {
    if (hubClient) {
      hubClient.registerEvent(
        HubEvents.AGENT_START,
        async (data: unknown, ack: (response: AgentStartResponse) => void) => {
          const hostname = this.globalConfig.globalConfig().hostname;

          try {
            const parsed = AgentStartRequestSchema.parse(data);

            if (parsed.sourceHostId !== this.hostService.getLocalHostId()) {
              this.notifyHubRequest("start", parsed.userId);
            }

            await this.startAgent(parsed.userId);

            ack({
              success: true,
              hostname,
            });
          } catch (error) {
            ack({
              success: false,
              error: String(error),
              hostname,
            });
          }
        },
      );

      hubClient.registerEvent(
        HubEvents.AGENT_STOP,
        async (data: unknown, ack: (response: AgentStopResponse) => void) => {
          try {
            const parsed = AgentStopRequestSchema.parse(data);

            if (parsed.sourceHostId !== this.hostService.getLocalHostId()) {
              this.notifyHubRequest("stop", parsed.userId);
            }

            await this.stopAgent(
              parsed.userId,
              "requestShutdown",
              parsed.reason,
            );

            ack({ success: true });
          } catch (error) {
            ack({ success: false, error: String(error) });
          }
        },
      );
    }
  }

  /** A client started in hub mode is hanging on the debug user, so this shows a notification of agent activity */
  notifyHubRequest(type: "start" | "stop", userId: string) {
    const username = this.userService.getUserById(userId)?.username || userId;

    this.promptNotification.notify({
      wake: true,
      userId: adminUserId,
      commentOutput: [`Received request from hub to ${type} ${username}`],
    });
  }

  async startAgent(userId: string, onStop?: (reason: string) => void) {
    // Check if agent is already running
    const existing = this.runningAgents.find((a) => a.agentUserId === userId);
    if (existing) {
      throw new Error(`Agent '${existing.agentUsername}' is already running`);
    }

    const agent = await createAgentRuntime(
      this,
      userId,
      this.globalConfig,
      this.hubClient,
      this.hostService,
      this.userService,
      this.promptNotification,
    );

    this.runningAgents.push(agent);
    this.onHeartbeatNeeded?.();

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
      this.onHeartbeatNeeded?.();

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

  getBufferLineCount(userId: string) {
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
