import { DatabaseService } from "@naisys/hub-database";
import {
  AgentStartRequest,
  AgentStartRequestSchema,
  AgentStartResponse,
  AgentStopRequest,
  AgentStopRequestSchema,
  AgentStopResponse,
  HubEvents,
} from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";
import { HubMailService } from "./hubMailService.js";

/** Handles agent_start requests by routing them to the least-loaded eligible host */
export function createHubAgentService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
  mailService: HubMailService,
) {
  naisysServer.registerEvent(
    HubEvents.AGENT_START,
    async (
      hostId: number,
      data: unknown,
      ack: (response: AgentStartResponse) => void,
    ) => {
      try {
        const parsed = AgentStartRequestSchema.parse(data);

        // Look up which hosts this user is assigned to
        const { assignedHostIds } = await dbService.usingDatabase(
          async (prisma) => {
            const userHosts = await prisma.user_hosts.findMany({
              where: { user_id: parsed.startUserId },
              select: { host_id: true },
            });

            return {
              assignedHostIds: userHosts.map((uh) => uh.host_id),
            };
          },
        );

        const requesterUserId = parsed.requesterUserId;

        // Determine eligible hosts: assigned hosts, or all connected if unassigned
        let eligibleHostIds: number[];
        if (assignedHostIds.length > 0) {
          eligibleHostIds = assignedHostIds;
        } else {
          eligibleHostIds = naisysServer
            .getConnectedClients()
            .map((c) => c.getHostId());
        }

        // Filter to connected hosts that can run agents
        const connectedEligible = eligibleHostIds.filter((hid) => {
          const conn = naisysServer.getConnectionByHostId(hid);
          return conn && conn.canRunAgents();
        });

        if (connectedEligible.length === 0) {
          ack({
            success: false,
            error: `No eligible hosts are online for user ${parsed.startUserId}`,
          });
          return;
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

        // Forward the start request to the selected host
        const sent = naisysServer.sendMessage<
          AgentStartRequest,
          AgentStartResponse
        >(
          bestHostId,
          HubEvents.AGENT_START,
          {
            startUserId: parsed.startUserId,
            requesterUserId,
            taskDescription: parsed.taskDescription,
            sourceHostId: hostId,
          },
          (response) => {
            if (response.success) {
              heartbeatService.addStartedAgent(bestHostId, parsed.startUserId);
            }
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
      await mailService.sendMail({
        fromUserId: requesterUserId,
        recipientUserIds: [startUserId],
        subject: "Your Task",
        body: taskDescription,
      });
    } catch (err) {
      logService.error(`[Hub:Agents] Failed to send task mail: ${err}`);
    }
  }

  naisysServer.registerEvent(
    HubEvents.AGENT_STOP,
    (
      hostId: number,
      data: unknown,
      ack: (response: AgentStopResponse) => void,
    ) => {
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
          const sent = naisysServer.sendMessage<
            AgentStopRequest,
            AgentStopResponse
          >(
            targetHostId,
            HubEvents.AGENT_STOP,
            {
              userId: parsed.userId,
              reason: parsed.reason,
              sourceHostId: hostId,
            },
            (response) => {
              if (response.success) {
                heartbeatService.removeStoppedAgent(
                  targetHostId,
                  parsed.userId,
                );
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
    },
  );
}
