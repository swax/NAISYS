import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import {
  AgentPeekRequestSchema,
  AgentRunCommandRequestSchema,
  AgentRunPauseRequestSchema,
  type AgentStartDispatch,
  AgentStartInboundSchema,
  AgentStopRequestSchema,
  HubEvents,
} from "@naisys/hub-protocol";

import type { HostRegistrar } from "../services/hostRegistrar.js";
import type { NaisysServer } from "../services/naisysServer.js";
import type { HubHeartbeatService } from "./hubHeartbeatService.js";
import type { HubRuntimeKeyService } from "./hubRuntimeKeyService.js";
import type { HubSendMailService } from "./hubSendMailService.js";

type AgentResponse = { success: boolean; error?: string };

type StartDecision =
  | { kind: "fail"; error: string }
  | { kind: "go"; bestHostId: number };

/** Handles agent_start requests by routing them to the least-loaded eligible host */
export function createHubAgentService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  heartbeatService: HubHeartbeatService,
  sendMailService: HubSendMailService,
  hostRegistrar: HostRegistrar,
  runtimeKeyService: HubRuntimeKeyService,
) {
  const { issueRuntimeApiKey, revokeRuntimeApiKey } = runtimeKeyService;
  /** Find the least-loaded eligible host for a given user */
  async function findBestHost(startUserId: number): Promise<number | null> {
    // Look up which hosts this user is assigned to
    const userHosts = await hubDb.user_hosts.findMany({
      where: { user_id: startUserId },
      select: { host_id: true },
    });
    const assignedHostIds = userHosts.map((uh) => uh.host_id);

    // Determine eligible hosts: assigned hosts, or all connected (non-restricted) if unassigned
    let eligibleHostIds: number[];
    if (assignedHostIds.length > 0) {
      eligibleHostIds = assignedHostIds;
    } else {
      const restrictedHostIds = new Set(
        hostRegistrar
          .getAllHosts()
          .filter((h) => h.restricted)
          .map((h) => h.hostId),
      );
      eligibleHostIds = naisysServer
        .getConnectedClients()
        .map((c) => c.getHostId())
        .filter((hid) => !restrictedHostIds.has(hid));
    }

    // Filter to connected hosts that can run agents
    const connectedEligible = eligibleHostIds.filter((hid) => {
      const conn = naisysServer.getConnectionByHostId(hid);
      return conn && conn.getHostType() === "naisys";
    });

    if (connectedEligible.length === 0) {
      return null;
    }

    // Pick the host with the fewest active agents
    let bestHostId = connectedEligible[0];
    let bestCount = heartbeatService.getHostActiveAgentCount(bestHostId);

    for (const hid of connectedEligible.slice(1)) {
      const count = heartbeatService.getHostActiveAgentCount(hid);
      if (count < bestCount) {
        bestHostId = hid;
        bestCount = count;
      }
    }

    return bestHostId;
  }

  /** Check if a user is enabled (not disabled or archived) */
  async function isAgentEnabled(userId: number): Promise<boolean> {
    const user = await hubDb.users.findUnique({
      where: { id: userId },
      select: { enabled: true, archived: true },
    });
    return !!user?.enabled && !user?.archived;
  }

  /** Run the start preconditions and pick a host. */
  async function decideStartAgent(userId: number): Promise<StartDecision> {
    if (!(await isAgentEnabled(userId))) {
      return { kind: "fail", error: `Agent ${userId} is disabled` };
    }
    if (heartbeatService.findHostsForAgent(userId).length > 0) {
      return { kind: "fail", error: `Agent ${userId} is already running` };
    }
    const bestHostId = await findBestHost(userId);
    if (bestHostId === null) {
      return {
        kind: "fail",
        error: `No eligible hosts are online for user ${userId}`,
      };
    }
    return { kind: "go", bestHostId };
  }

  /**
   * Mint and ship a key with AGENT_START so the agent's authenticated from
   * spawn time, avoiding the one-RTT window heartbeat-only would create.
   * Heartbeat-driven reissue covers later hash mismatches.
   */
  async function dispatchAgentStart(args: {
    bestHostId: number;
    payload: Omit<AgentStartDispatch, "runtimeApiKey">;
    onResponse: (response: AgentResponse) => void;
  }): Promise<{ sent: boolean }> {
    const { bestHostId, payload, onResponse } = args;
    const startUserId = payload.startUserId;
    const runtimeApiKey = await issueRuntimeApiKey(startUserId);

    const sent = naisysServer.sendMessage(
      bestHostId,
      HubEvents.AGENT_START,
      { ...payload, runtimeApiKey },
      (response: AgentResponse) => {
        if (response.success) {
          heartbeatService.addStartedAgent(bestHostId, startUserId);
        }
        onResponse(response);
      },
    );

    return { sent };
  }

  /** Try to start an agent on the best available host (fire-and-forget) */
  async function tryStartAgent(startUserId: number): Promise<boolean> {
    try {
      const decision = await decideStartAgent(startUserId);
      if (decision.kind === "fail") {
        logService.log(`[Hub:Agents] Auto-start: ${decision.error}`);
        return false;
      }

      const { sent } = await dispatchAgentStart({
        bestHostId: decision.bestHostId,
        payload: { startUserId },
        onResponse: (response) => {
          if (!response.success) {
            logService.error(
              `[Hub:Agents] Auto-start failed for user ${startUserId}: ${response.error}`,
            );
          }
        },
      });

      if (sent) {
        logService.log(
          `[Hub:Agents] Auto-start: sent start for user ${startUserId} to host ${decision.bestHostId}`,
        );
      }
      return sent;
    } catch (error) {
      logService.error(`[Hub:Agents] Auto-start error: ${error}`);
      return false;
    }
  }

  naisysServer.registerEvent(
    HubEvents.AGENT_START,
    async (hostId, data, ack) => {
      try {
        const parsed = AgentStartInboundSchema.parse(data);

        const decision = await decideStartAgent(parsed.startUserId);
        if (decision.kind === "fail") {
          ack({ success: false, error: decision.error });
          return;
        }

        const { sent } = await dispatchAgentStart({
          bestHostId: decision.bestHostId,
          payload: {
            startUserId: parsed.startUserId,
            taskDescription: parsed.taskDescription,
            sourceHostId: hostId,
          },
          onResponse: (response) => {
            // Reverse-ack with the response from the host (including success status and any error message) back to the original requester
            ack(response);
            // Send task description mail after successful start to avoid
            // orphaned mails from failed start attempts
            if (response.success && parsed.taskDescription) {
              void sendTaskMail(
                parsed.startUserId,
                parsed.requesterUserId,
                parsed.taskDescription,
              );
            }
          },
        });

        if (!sent) {
          ack({
            success: false,
            error: `Failed to send to host ${decision.bestHostId}`,
          });
        }
      } catch (error) {
        logService.error(
          `[Hub:Agents] agent_start error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  async function sendTaskMail(
    startUserId: number,
    requesterUserId: number,
    taskDescription: string,
  ) {
    try {
      await sendMailService.sendMail({
        fromUserId: requesterUserId,
        recipientUserIds: [startUserId],
        subject: "Agent Start", // Agent will send a 'Session Completed' mail when session is completed
        body: taskDescription,
        kind: "mail",
      });
    } catch (err) {
      logService.error(`[Hub:Agents] Failed to send task mail: ${err}`);
    }
  }

  naisysServer.registerEvent(HubEvents.AGENT_STOP, (hostId, data, ack) => {
    try {
      const parsed = AgentStopRequestSchema.parse(data);

      // Find which hosts the agent is currently running on
      const targetHostIds = heartbeatService.findHostsForAgent(parsed.userId);

      if (targetHostIds.length === 0) {
        ack({
          success: false,
          error: `Agent ${parsed.userId} is not running on any known host`,
        });
        return;
      }

      // Forward the stop request to all hosts running this agent
      let acked = false;
      let sendFailures = 0;

      for (const targetHostId of targetHostIds) {
        const sent = naisysServer.sendMessage(
          targetHostId,
          HubEvents.AGENT_STOP,
          {
            userId: parsed.userId,
            reason: parsed.reason,
            sourceHostId: hostId,
          },
          (response) => {
            if (response.success) {
              heartbeatService.removeStoppedAgent(targetHostId, parsed.userId);
              revokeRuntimeApiKey(parsed.userId).catch((err) => {
                logService.error(
                  `[Hub:Agents] Failed to revoke runtime key for user ${parsed.userId} on stop: ${err}`,
                );
              });
            }
            // Ack with the first response
            if (!acked) {
              acked = true;
              ack(response);
            }
          },
        );

        if (!sent) {
          sendFailures++;
        }
      }

      if (sendFailures === targetHostIds.length && !acked) {
        ack({
          success: false,
          error: `No target hosts are connected`,
        });
      }
    } catch (error) {
      logService.error(
        `[Hub:Agents] agent_stop error from host ${hostId}: ${error}`,
      );
      ack({ success: false, error: String(error) });
    }
  });

  function registerRunPauseHandler(
    event: typeof HubEvents.AGENT_RUN_PAUSE | typeof HubEvents.AGENT_RUN_RESUME,
  ) {
    naisysServer.registerEvent(event, (hostId, data, ack) => {
      try {
        const parsed = AgentRunPauseRequestSchema.parse(data);

        const targetHostIds = heartbeatService.findHostsForAgent(parsed.userId);

        if (targetHostIds.length === 0) {
          ack({
            success: false,
            error: `Agent ${parsed.userId} is not running on any known host`,
          });
          return;
        }

        let acked = false;
        let sendFailures = 0;

        for (const targetHostId of targetHostIds) {
          const sent = naisysServer.sendMessage(
            targetHostId,
            event,
            {
              userId: parsed.userId,
              runId: parsed.runId,
              subagentId: parsed.subagentId,
              sessionId: parsed.sessionId,
              sourceHostId: hostId,
            },
            (response) => {
              if (!acked) {
                acked = true;
                ack(response);
              }
            },
          );

          if (!sent) {
            sendFailures++;
          }
        }

        if (sendFailures === targetHostIds.length && !acked) {
          ack({
            success: false,
            error: `No target hosts are connected`,
          });
        }
      } catch (error) {
        logService.error(
          `[Hub:Agents] ${event} error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    });
  }

  registerRunPauseHandler(HubEvents.AGENT_RUN_PAUSE);
  registerRunPauseHandler(HubEvents.AGENT_RUN_RESUME);

  naisysServer.registerEvent(
    HubEvents.AGENT_RUN_COMMAND,
    (hostId, data, ack) => {
      try {
        const parsed = AgentRunCommandRequestSchema.parse(data);

        const targetHostIds = heartbeatService.findHostsForAgent(parsed.userId);

        if (targetHostIds.length === 0) {
          ack({
            success: false,
            error: `Agent ${parsed.userId} is not running on any known host`,
          });
          return;
        }

        let acked = false;
        let sendFailures = 0;

        for (const targetHostId of targetHostIds) {
          const sent = naisysServer.sendMessage(
            targetHostId,
            HubEvents.AGENT_RUN_COMMAND,
            {
              userId: parsed.userId,
              runId: parsed.runId,
              subagentId: parsed.subagentId,
              sessionId: parsed.sessionId,
              command: parsed.command,
              sourceHostId: hostId,
            },
            (response) => {
              if (!acked) {
                acked = true;
                ack(response);
              }
            },
          );

          if (!sent) {
            sendFailures++;
          }
        }

        if (sendFailures === targetHostIds.length && !acked) {
          ack({
            success: false,
            error: `No target hosts are connected`,
          });
        }
      } catch (error) {
        logService.error(
          `[Hub:Agents] ${HubEvents.AGENT_RUN_COMMAND} error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  naisysServer.registerEvent(HubEvents.AGENT_PEEK, (hostId, data, ack) => {
    try {
      const parsed = AgentPeekRequestSchema.parse(data);

      // Find which host the agent is running on
      const targetHostIds = heartbeatService.findHostsForAgent(parsed.userId);

      if (targetHostIds.length === 0) {
        ack({
          success: false,
          error: `Agent ${parsed.userId} is not running on any known host`,
        });
        return;
      }

      // Forward peek request to the first host (only need one response)
      const targetHostId = targetHostIds[0];
      const sent = naisysServer.sendMessage(
        targetHostId,
        HubEvents.AGENT_PEEK,
        {
          userId: parsed.userId,
          skip: parsed.skip,
          take: parsed.take,
          sourceHostId: hostId,
        },
        (response) => {
          ack(response);
        },
      );

      if (!sent) {
        ack({
          success: false,
          error: `Failed to send to host ${targetHostId}`,
        });
      }
    } catch (error) {
      logService.error(
        `[Hub:Agents] agent_peek error from host ${hostId}: ${error}`,
      );
      ack({ success: false, error: String(error) });
    }
  });

  return { tryStartAgent };
}

export type HubAgentService = ReturnType<typeof createHubAgentService>;
