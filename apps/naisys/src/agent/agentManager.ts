import { sleep } from "@naisys/common";
import {
  AgentPeekRequestSchema,
  AgentStartRequestSchema,
  AgentStopRequestSchema,
  HubEvents,
} from "@naisys/hub-protocol";
import stripAnsi from "strip-ansi";

import type { GlobalConfig } from "../globalConfig.js";
import type { HubClient } from "../hub/hubClient.js";
import type { HubCostBuffer } from "../hub/hubCostBuffer.js";
import type { HubLogBuffer } from "../hub/hubLogBuffer.js";
import type { HostService } from "../services/hostService.js";
import type { ModelService } from "../services/modelService.js";
import { OutputColor } from "../utils/output.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";
import type { AgentRuntime } from "./agentRuntime.js";
import { createAgentRuntime } from "./agentRuntime.js";
import type { UserService } from "./userService.js";

/** Handles the multiplexing of multiple concurrent agents in the process */
export class AgentManager {
  runningAgents: AgentRuntime[] = [];
  private runPromises = new Map<number, Promise<void>>();
  onHeartbeatNeeded?: () => void;

  constructor(
    private globalConfig: GlobalConfig,
    private hubClient: HubClient | undefined,
    private hubCostBuffer: HubCostBuffer | undefined,
    private hubLogBuffer: HubLogBuffer | undefined,
    private hostService: HostService,
    private userService: UserService,
    private modelService: ModelService,
    private promptNotification: PromptNotificationService,
  ) {
    if (hubClient) {
      hubClient.registerEvent(HubEvents.AGENT_START, async (data, ack) => {
        const hostname = this.globalConfig.globalConfig().hostname;

        try {
          const parsed = AgentStartRequestSchema.parse(data);

          if (parsed.sourceHostId !== this.hostService.getLocalHostId()) {
            this.notifyHubRequest("start", parsed.startUserId);
          }

          await this.startAgent(parsed.startUserId);

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
      });

      hubClient.registerEvent(HubEvents.AGENT_STOP, async (data, ack) => {
        try {
          const parsed = AgentStopRequestSchema.parse(data);

          if (parsed.sourceHostId !== this.hostService.getLocalHostId()) {
            this.notifyHubRequest("stop", parsed.userId);
          }

          await this.stopAgent(parsed.userId, parsed.reason);

          ack({ success: true });
        } catch (error) {
          ack({ success: false, error: String(error) });
        }
      });

      hubClient.registerEvent(HubEvents.AGENT_PEEK, (data, ack) => {
        try {
          const parsed = AgentPeekRequestSchema.parse(data);

          const allLines = this.getBufferLines(parsed.userId).map((line) =>
            stripAnsi(line),
          );
          const totalLines = allLines.length;

          const skip = parsed.skip ?? 0;
          const take = parsed.take ?? totalLines;
          const lines = allLines.slice(skip, skip + take);

          ack({ success: true, lines, totalLines });
        } catch (error) {
          ack({ success: false, error: String(error) });
        }
      });
    }
  }

  /** A client started in hub mode is hanging on the debug user, so this shows a notification of agent activity */
  notifyHubRequest(type: "start" | "stop", userId: number) {
    const username =
      this.userService.getUserById(userId)?.username || String(userId);
    const adminUserId = this.userService.getUserByName("admin")?.userId ?? 0;

    this.promptNotification.notify({
      wake: "always",
      userId: adminUserId,
      commentOutput: [`Received request from hub to ${type} ${username}`],
    });
  }

  async startAgent(userId: number, onStop?: (reason: string) => void) {
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
      this.hubCostBuffer,
      this.hubLogBuffer,
      this.hostService,
      this.userService,
      this.modelService,
      this.promptNotification,
    );

    this.runningAgents.push(agent);
    this.onHeartbeatNeeded?.();

    if (this.runningAgents.length === 1) {
      this.setActiveConsoleAgent(agent.agentUserId);
    }

    const runPromise = agent
      .runCommandLoop()
      .catch((ex: any) => `error: ${ex}`)
      .then((exitReason) => {
        onStop?.(exitReason);
        this.cleanupAgent(agent);
      });

    this.runPromises.set(userId, runPromise);

    return agent.agentUserId;
  }

  async stopAgent(agentUserId: number, reason: string) {
    const agent = this.runningAgents.find((a) => a.agentUserId === agentUserId);

    if (!agent) {
      throw new Error(`Agent with user ID ${agentUserId} not found`);
    }

    // Signal the command loop to exit
    agent.requestShutdown(reason);

    // Wake the agent if it's blocked waiting for input (debug prompt timeout, etc.)
    this.promptNotification.notify({
      wake: "always",
      userId: agentUserId,
      commentOutput: [],
    });

    // Wait for the command loop to actually finish and cleanup to complete
    const runPromise = this.runPromises.get(agentUserId);
    if (runPromise) {
      await runPromise;
    }
  }

  private cleanupAgent(agent: AgentRuntime) {
    if (agent.output.isConsoleEnabled()) {
      const switchToAgent = this.runningAgents.find((a) => a !== agent);

      if (switchToAgent) {
        this.setActiveConsoleAgent(switchToAgent.agentUserId);
      }
    }

    const agentIndex = this.runningAgents.findIndex((a) => a === agent);
    if (agentIndex >= 0) {
      this.runningAgents.splice(agentIndex, 1);
    }

    this.onHeartbeatNeeded?.();
    agent.completeShutdown();
    this.runPromises.delete(agent.agentUserId);
  }

  setActiveConsoleAgent(userId: number) {
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

  getBufferLines(userId: number) {
    const agent = this.runningAgents.find((a) => a.agentUserId === userId);

    if (!agent) {
      return [];
    }

    return [...agent.output.consoleBuffer];
  }

  async waitForAllAgentsToComplete() {
    // Poll every second to see if there are running agents
    while (this.runningAgents.length > 0) {
      await sleep(1000);
    }
  }
}
