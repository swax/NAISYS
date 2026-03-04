import type { HubDatabaseService } from "@naisys/hub-database";
import {
  AgentPeekRequestSchema,
  AgentStartRequestSchema,
  AgentStopRequestSchema,
  HubEvents,
} from "@naisys/hub-protocol";

import { HostRegistrar } from "../services/hostRegistrar.js";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";
import { HubSendMailService } from "./hubSendMailService.js";

/** Handles agent_start requests by routing them to the least-loaded eligible host */
export function createHubAgentService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
  sendMailService: HubSendMailService,
  hostRegistrar: HostRegistrar,
) {
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

  /** Try to start an agent on the best available host (fire-and-forget) */
  async function tryStartAgent(startUserId: number): Promise<boolean> {
    try {
      const bestHostId = await findBestHost(startUserId);
      if (bestHostId === null) {
        logService.log(
          `[Hub:Agents] Auto-start: no eligible host for user ${startUserId}`,
        );
        return false;
      }

      const sent = naisysServer.sendMessage(
        bestHostId,
        HubEvents.AGENT_START,
        {
          startUserId,
        },
        (response) => {
          if (response.success) {
            heartbeatService.addStartedAgent(bestHostId, startUserId);
          } else {
            logService.error(
              `[Hub:Agents] Auto-start failed for user ${startUserId}: ${response.error}`,
            );
          }
        },
      );

      if (sent) {
        logService.log(
          `[Hub:Agents] Auto-start: sent start for user ${startUserId} to host ${bestHostId}`,
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
        const parsed = AgentStartRequestSchema.parse(data);
        const requesterUserId = parsed.requesterUserId;

        const bestHostId = await findBestHost(parsed.startUserId);

        if (bestHostId === null) {
          ack({
            success: false,
            error: `No eligible hosts are online for user ${parsed.startUserId}`,
          });
          return;
        }

        if (!requesterUserId) {
          ack({
            success: false,
            error: `Missing requesterUserId in agent_start request for user ${parsed.startUserId}`,
          });
          return;
        }

        // Forward the start request to the selected host
        const sent = naisysServer.sendMessage(
          bestHostId,
          HubEvents.AGENT_START,
          {
            startUserId: parsed.startUserId,
            taskDescription: parsed.taskDescription,
            sourceHostId: hostId,
          },
          (response) => {
            if (response.success) {
              heartbeatService.addStartedAgent(bestHostId, parsed.startUserId);
            }

            // Reverse-ack with the response from the host (including success status and any error message) back to the original requester
            ack(response);
            // Send task description mail after successful start to avoid
            // orphaned mails from failed start attempts
            if (response.success && parsed.taskDescription) {
              void sendTaskMail(
                parsed.startUserId,
                requesterUserId,
                parsed.taskDescription,
              );
            }
          },
        );

        if (!sent) {
          ack({
            success: false,
            error: `Failed to send to host ${bestHostId}`,
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
