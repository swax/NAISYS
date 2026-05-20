import type { DualLogger } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import {
  HubEvents,
  SessionCreateRequestSchema,
  SessionIncrementRequestSchema,
} from "@naisys/hub-protocol";

import type { NaisysServer } from "../server/naisysServer.js";
import type { HubOwnershipService } from "./hubOwnershipService.js";

/** Handles session_create and session_increment requests from NAISYS instances */
export function createHubRunService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  logService: DualLogger,
  ownershipService: HubOwnershipService,
) {
  naisysServer.registerEvent(
    HubEvents.SESSION_CREATE,
    async (hostId, data, ack) => {
      try {
        const parsed = SessionCreateRequestSchema.parse(data);

        // Without this guard, a host could forge run_session rows for
        // arbitrary users and poison the ACL preload that reads them at boot.
        if (!ownershipService.hostOwnsUser(hostId, parsed.userId)) {
          logService.log(
            `[Hub:Runs] Rejected session_create from host ${hostId} for user ${parsed.userId}: host is not the authorized owner`,
          );
          ack({ success: false, error: "Not authorized" });
          return;
        }

        // Subagent path: inherit the parent's runId rather than allocating a new one.
        let runId: number;
        if (parsed.subagentId !== undefined) {
          if (parsed.parentRunId === undefined) {
            throw new Error("parentRunId is required when subagentId is set");
          }
          // Confirm the parent's run row exists before materializing a child
          // under it — otherwise we'd silently create an orphan subagent row.
          const parent = await hubDb.run_session.findFirst({
            where: {
              user_id: parsed.userId,
              run_id: parsed.parentRunId,
              subagent_id: 0,
            },
            select: { run_id: true },
          });
          if (!parent) {
            throw new Error(
              `parent run ${parsed.parentRunId} not found for user ${parsed.userId}`,
            );
          }
          runId = parsed.parentRunId;
        } else {
          const lastRun = await hubDb.run_session.findFirst({
            select: { run_id: true },
            orderBy: { run_id: "desc" },
          });
          runId = lastRun ? lastRun.run_id + 1 : 1;
        }

        const subagentId = parsed.subagentId ?? 0;
        const newSessionId = 1;
        const now = new Date().toISOString();

        await hubDb.run_session.create({
          data: {
            user_id: parsed.userId,
            run_id: runId,
            subagent_id: subagentId,
            session_id: newSessionId,
            host_id: hostId,
            model_name: parsed.modelName,
            created_at: now,
            last_active: now,
          },
        });

        ack({
          success: true,
          runId,
          sessionId: newSessionId,
        });
      } catch (error) {
        logService.error(
          `[Hub:Runs] session_create error for host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  naisysServer.registerEvent(
    HubEvents.SESSION_INCREMENT,
    async (hostId, data, ack) => {
      try {
        const parsed = SessionIncrementRequestSchema.parse(data);

        if (!ownershipService.hostOwnsUser(hostId, parsed.userId)) {
          logService.log(
            `[Hub:Runs] Rejected session_increment from host ${hostId} for user ${parsed.userId}: host is not the authorized owner`,
          );
          ack({ success: false, error: "Not authorized" });
          return;
        }

        const subagentId = parsed.subagentId ?? 0;

        // Get the max session_id for this user + run + subagent
        const lastSession = await hubDb.run_session.findFirst({
          select: { session_id: true },
          where: {
            user_id: parsed.userId,
            run_id: parsed.runId,
            subagent_id: subagentId,
          },
          orderBy: { session_id: "desc" },
        });

        const newSessionId = lastSession ? lastSession.session_id + 1 : 1;
        const now = new Date().toISOString();

        await hubDb.run_session.create({
          data: {
            user_id: parsed.userId,
            run_id: parsed.runId,
            subagent_id: subagentId,
            session_id: newSessionId,
            host_id: hostId,
            model_name: parsed.modelName,
            created_at: now,
            last_active: now,
          },
        });

        ack({ success: true, sessionId: newSessionId });
      } catch (error) {
        logService.error(
          `[Hub:Runs] session_increment error for host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );
}
