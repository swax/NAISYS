import { DatabaseService } from "@naisys/database";
import {
  HubEvents,
  SessionCreateRequestSchema,
  SessionIncrementRequestSchema,
} from "@naisys/hub-protocol";
import { HostService } from "../services/hostService.js";
import { HubServerLog } from "../services/hubServerLog.js";
import { RunnerServer } from "../services/runnerServer.js";

/** Handles session_create and session_increment requests from runners */
export function createHubRunService(
  runnerServer: RunnerServer,
  dbService: DatabaseService,
  hostService: HostService,
  logService: HubServerLog,
) {
  const { localHostId } = hostService;

  runnerServer.registerEvent(
    HubEvents.SESSION_CREATE,
    async (
      runnerId: string,
      data: unknown,
      ack: (response: unknown) => void,
    ) => {
      try {
        const parsed = SessionCreateRequestSchema.parse(data);

        const result = await dbService.usingDatabase(async (prisma) => {
          // Get the last run_id across all sessions
          const lastRun = await prisma.run_session.findFirst({
            select: { run_id: true },
            orderBy: { run_id: "desc" },
          });

          const newRunId = lastRun ? lastRun.run_id + 1 : 1;
          const newSessionId = 1;

          await prisma.run_session.create({
            data: {
              user_id: parsed.userId,
              run_id: newRunId,
              session_id: newSessionId,
              host_id: localHostId,
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
          `[HubRunService] session_create error for runner ${runnerId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );

  runnerServer.registerEvent(
    HubEvents.SESSION_INCREMENT,
    async (
      runnerId: string,
      data: unknown,
      ack: (response: unknown) => void,
    ) => {
      try {
        const parsed = SessionIncrementRequestSchema.parse(data);

        const result = await dbService.usingDatabase(async (prisma) => {
          // Get the max session_id for this user + run
          const lastSession = await prisma.run_session.findFirst({
            select: { session_id: true },
            where: {
              user_id: parsed.userId,
              run_id: parsed.runId,
            },
            orderBy: { session_id: "desc" },
          });

          const newSessionId = lastSession ? lastSession.session_id + 1 : 1;

          await prisma.run_session.create({
            data: {
              user_id: parsed.userId,
              run_id: parsed.runId,
              session_id: newSessionId,
              host_id: localHostId,
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
          `[HubRunService] session_increment error for runner ${runnerId}: ${error}`,
        );
        ack({ success: false, error: String(error) });
      }
    },
  );
}
