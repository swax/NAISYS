import { ADMIN_USERNAME, sleep } from "@naisys/common";
import {
  AgentPeekRequestSchema,
  AgentRunCommandRequestSchema,
  AgentRunPauseRequestSchema,
  AgentStartDispatchSchema,
  AgentStopRequestSchema,
  HubEvents,
  RuntimeKeyReissueSchema,
} from "@naisys/hub-protocol";
import stripAnsi from "strip-ansi";

import type { GlobalConfig } from "../globalConfig.js";
import type { HubClient } from "../hub/hubClient.js";
import type { HubCostBuffer } from "../hub/hubCostBuffer.js";
import type { HubLogBuffer } from "../hub/hubLogBuffer.js";
import type { HostService } from "../services/hostService.js";
import type { ModelService } from "../services/modelService.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";
import type { SubagentContext } from "./agentManagerInterface.js";
import type { AgentRuntime } from "./agentRuntime.js";
import { createAgentRuntime } from "./agentRuntime.js";
import type { UserService } from "./userService.js";

/** Handles the multiplexing of multiple concurrent agents in the process */
export class AgentManager {
  runningAgents: AgentRuntime[] = [];
  private runPromises = new Map<number, Promise<void>>();
  // Guards cleanupAgent against double-entry: stopAgent's force-stop-on-timeout
  // path and the runPromise resolution can both fire it for the same agent.
  private cleanupStarted = new WeakSet<AgentRuntime>();
  // onStop runs from cleanupAgent (not the runPromise continuation) so the
  // force-stop-on-timeout path still fires it — otherwise an ephemeral whose
  // command loop never resolves after abort would leak in userService.
  private onStopCallbacks = new Map<number, (reason: string) => void>();
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
          const parsed = AgentStartDispatchSchema.parse(data);

          if (parsed.sourceHostId !== this.hostService.getLocalHostId()) {
            this.notifyHubRequest("start", parsed.startUserId);
          }

          await this.startAgent(
            parsed.startUserId,
            parsed.runtimeApiKey,
          );

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

      const registerRunPauseHandler = (
        event:
          | typeof HubEvents.AGENT_RUN_PAUSE
          | typeof HubEvents.AGENT_RUN_RESUME,
      ) => {
        hubClient.registerEvent(event, (data, ack) => {
          try {
            const parsed = AgentRunPauseRequestSchema.parse(data);

            // Subagents are looked up by their synthetic id; main agents by userId
            const targetId = parsed.subagentId ?? parsed.userId;
            const agent = this.runningAgents.find(
              (a) => a.agentUserId === targetId,
            );
            if (!agent) {
              ack({
                success: false,
                error: `Agent ${targetId} is not running on this host`,
              });
              return;
            }

            // The caller addressed a specific run/session; reject if the
            // agent has since moved on (compacted session, new run, etc.)
            if (
              agent.getRunId() !== parsed.runId ||
              agent.getSessionId() !== parsed.sessionId
            ) {
              ack({
                success: false,
                error: `Run/session is no longer the active one for agent ${targetId}`,
              });
              return;
            }

            const paused = event === HubEvents.AGENT_RUN_PAUSE;
            const changed = agent.setPaused(paused);
            // Immediate heartbeat so the supervisor UI reflects the change
            // within roundtrip latency instead of waiting for the 2s tick
            if (changed) {
              this.onHeartbeatNeeded?.();
            }

            ack({ success: true, changed });
          } catch (error) {
            ack({ success: false, error: String(error) });
          }
        });
      };

      registerRunPauseHandler(HubEvents.AGENT_RUN_PAUSE);
      registerRunPauseHandler(HubEvents.AGENT_RUN_RESUME);

      hubClient.registerEvent(HubEvents.AGENT_RUN_COMMAND, (data, ack) => {
        try {
          const parsed = AgentRunCommandRequestSchema.parse(data);

          const targetId = parsed.subagentId ?? parsed.userId;
          const agent = this.runningAgents.find(
            (a) => a.agentUserId === targetId,
          );
          if (!agent) {
            ack({
              success: false,
              error: `Agent ${targetId} is not running on this host`,
            });
            return;
          }

          if (
            agent.getRunId() !== parsed.runId ||
            agent.getSessionId() !== parsed.sessionId
          ) {
            ack({
              success: false,
              error: `Run/session is no longer the active one for agent ${targetId}`,
            });
            return;
          }

          this.promptNotification.notify({
            wake: "always",
            userId: targetId,
            debugCommands: [parsed.command],
          });

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

      hubClient.registerEvent(HubEvents.RUNTIME_KEY_REISSUE, (data) => {
        const parsed = RuntimeKeyReissueSchema.parse(data);
        const agent = this.runningAgents.find(
          (a) => a.agentUserId === parsed.userId,
        );
        if (!agent) return;
        agent.rotateApiKey(parsed.runtimeApiKey);
      });
    }
  }

  /** A client started in hub mode is hanging on the debug user, so this shows a notification of agent activity */
  notifyHubRequest(type: "start" | "stop", userId: number) {
    const username =
      this.userService.getUserById(userId)?.username || String(userId);
    const adminUserId =
      this.userService.getUserByName(ADMIN_USERNAME)?.userId ?? 0;

    this.promptNotification.notify({
      wake: "always",
      userId: adminUserId,
      commentOutput: [`Received request from hub to ${type} ${username}`],
    });
  }

  async startAgent(
    userId: number,
    runtimeApiKey?: string,
    onStop?: (reason: string) => void,
    subagentContext?: SubagentContext,
  ) {
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
      subagentContext,
    );

    // Apply before push so the immediate onHeartbeatNeeded fires with the
    // key already in runtimeKeyRef — otherwise the heartbeat sends an
    // empty claim and the hub mints a redundant key.
    if (runtimeApiKey) {
      agent.rotateApiKey(runtimeApiKey);
    }

    this.runningAgents.push(agent);
    this.onHeartbeatNeeded?.();

    if (this.runningAgents.length === 1) {
      this.setActiveConsoleAgent(agent.agentUserId);
    }

    if (onStop) {
      this.onStopCallbacks.set(userId, onStop);
    }

    const runPromise = agent
      .runCommandLoop()
      .then((exitReason) => this.cleanupAgent(agent, exitReason));

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
      const result = await Promise.race([
        runPromise.then(() => "done" as const),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 10_000),
        ),
      ]);
      if (result === "timeout") {
        agent.output.error(
          `[NAISYS] Force stopping ${agent.agentUsername} (timed out)`,
        );
        await this.cleanupAgent(agent, reason);
      }
    }
  }

  async stopAll(reason: string, excludeUserId?: number) {
    const agents = this.runningAgents.filter(
      (a) => a.agentUserId !== excludeUserId,
    );
    await Promise.all(agents.map((a) => this.stopAgent(a.agentUserId, reason)));
  }

  private async cleanupAgent(agent: AgentRuntime, reason: string) {
    if (this.cleanupStarted.has(agent)) return;
    this.cleanupStarted.add(agent);

    // Stop ephemeral children first so they drain final log/cost writes
    // through the parent's still-live host buffers.
    await agent.subagentService.cleanup();

    const agentIndex = this.runningAgents.findIndex((a) => a === agent);

    if (agentIndex >= 0) {
      if (agent.output.isConsoleEnabled()) {
        const switchToAgent = this.runningAgents.find((a) => a !== agent);

        if (switchToAgent) {
          this.setActiveConsoleAgent(switchToAgent.agentUserId);
        }
      }

      // Splice from runningAgents before onStop, since onStop may remove the
      // ephemeral from userMap and the heartbeat reads both.
      this.runningAgents.splice(agentIndex, 1);
      this.onHeartbeatNeeded?.();
      agent.completeShutdown();
      this.runPromises.delete(agent.agentUserId);
    }

    const onStop = this.onStopCallbacks.get(agent.agentUserId);
    this.onStopCallbacks.delete(agent.agentUserId);
    onStop?.(reason);
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
      prevActiveAgent.output.notice(
        `Switching to agent ${newActiveAgent.agentUsername}`,
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
