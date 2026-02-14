import { DatabaseService } from "@naisys/database";
import {
  AgentStartRequestSchema,
  AgentStartResponse,
  AgentStopRequestSchema,
  AgentStopResponse,
  HubEvents,
} from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";
import { HubHeartbeatService } from "./hubHeartbeatService.js";

/** Handles agent_start requests by routing them to the least-loaded eligible host */
export function createHubAgentService(
  naisysServer: NaisysServer,
  dbService: DatabaseService,
  logService: HubServerLog,
  heartbeatService: HubHeartbeatService,
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
        const assignedHostIds = await dbService.usingDatabase(
          async (prisma) => {
            const userHosts = await prisma.user_hosts.findMany({
              where: { user_id: parsed.userId },
              select: { host_id: true },
            });
            return userHosts.map((uh) => uh.host_id);
          },
        );

        // Determine eligible hosts: assigned hosts, or all connected if unassigned
        let eligibleHostIds: number[];
        if (assignedHostIds.length > 0) {
          eligibleHostIds = assignedHostIds;
        } else {
          eligibleHostIds = naisysServer
            .getConnectedClients()
            .map((c) => c.getHostId());
        }

        // Filter to connected hosts only, excluding the requesting host (e.g. supervisor)
        const connectedEligible = eligibleHostIds.filter(
          (hid) => hid !== hostId && naisysServer.getConnectionByHostId(hid),
        );

        if (connectedEligible.length === 0) {
          ack({
            success: false,
            error: `No eligible hosts are online for user ${parsed.userId}`,
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
        const sent = naisysServer.sendMessage<AgentStartResponse>(
          bestHostId,
          HubEvents.AGENT_START,
          {
            userId: parsed.userId,
            taskDescription: parsed.taskDescription,
            sourceHostId: hostId,
          },
          (response) => {
            if (response.success) {
              heartbeatService.addStartedAgent(bestHostId, parsed.userId);
            }
            ack(response);
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
          `[HubAgentService] agent_start error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

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
          const sent = naisysServer.sendMessage<AgentStopResponse>(
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
          `[HubAgentService] agent_stop error from host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );
}
