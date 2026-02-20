import type { HubDatabaseService } from "@naisys/hub-database";
import {
  HubEvents,
  SessionCreateRequestSchema,
  SessionIncrementRequestSchema,
} from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Handles session_create and session_increment requests from NAISYS instances */
export function createHubRunService(
  naisysServer: NaisysServer,
  { usingHubDatabase }: HubDatabaseService,
  logService: HubServerLog,
) {
  naisysServer.registerEvent(
    HubEvents.SESSION_CREATE,
    async (hostId: number, data: unknown, ack: (response: unknown) => void) => {
      try {
        const parsed = SessionCreateRequestSchema.parse(data);

        const result = await usingHubDatabase(async (hubDb) => {
          // Get the last run_id across all sessions
          const lastRun = await hubDb.run_session.findFirst({
            select: { run_id: true },
            orderBy: { run_id: "desc" },
          });

          const newRunId = lastRun ? lastRun.run_id + 1 : 1;
          const newSessionId = 1;

          await hubDb.run_session.create({
            data: {
              user_id: parsed.userId,
              run_id: newRunId,
              session_id: newSessionId,
              host_id: hostId,
              model_name: parsed.modelName,
              created_at: new Date().toISOString(),
              last_active: new Date().toISOString(),
            },
          });

          return { runId: newRunId, sessionId: newSessionId };
        });

        ack({
          success: true,
          runId: result.runId,
          sessionId: result.sessionId,
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
    async (hostId: number, data: unknown, ack: (response: unknown) => void) => {
      try {
        const parsed = SessionIncrementRequestSchema.parse(data);

        const result = await usingHubDatabase(async (hubDb) => {
          // Get the max session_id for this user + run
          const lastSession = await hubDb.run_session.findFirst({
            select: { session_id: true },
            where: {
              user_id: parsed.userId,
              run_id: parsed.runId,
            },
            orderBy: { session_id: "desc" },
          });

          const newSessionId = lastSession ? lastSession.session_id + 1 : 1;

          await hubDb.run_session.create({
            data: {
              user_id: parsed.userId,
              run_id: parsed.runId,
              session_id: newSessionId,
              host_id: hostId,
              model_name: "",
              created_at: new Date().toISOString(),
              last_active: new Date().toISOString(),
            },
          });

          return { sessionId: newSessionId };
        });

        ack({ success: true, sessionId: result.sessionId });
      } catch (error) {
        logService.error(
          `[Hub:Runs] session_increment error for host ${hostId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );
}
