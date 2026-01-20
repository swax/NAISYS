import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { DatabaseService } from "@naisys/database";
import { HostService } from "./hostService.js";

export async function createRunService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  { usingDatabase }: DatabaseService,
  hostService: HostService,
) {
  const { localHostId } = hostService;
  let userId = "";

  /** The run ID of an agent process (there could be multiple runs for the same user). Globally unique */
  let runId = -1;

  /** The session number, incremented when the agent calls ns-session compact */
  let sessionId = -1;

  let updateInterval: NodeJS.Timeout | null = null;

  await init();

  async function init() {
    await initUser();

    await initRun();

    // Start the last_active updater after user is initialized
    await updateLastActive();
    updateInterval = setInterval(updateLastActive, 2000);
  }

  async function initUser(): Promise<void> {
    userId = await usingDatabase(async (prisma) => {
      // If user is not in the db, add them
      const user = await prisma.users.findUnique({
        where: { username_host_id: { username: agentConfig().username, host_id: localHostId } },
        select: { id: true },
      });

      if (!user) {
        throw new Error(`User ${agentConfig().username} not found in database`);
      }

      return user.id;
    });
  }

  async function initRun(): Promise<void> {
    await usingDatabase(async (prisma) => {
      // increment the existing run id in the run_session table, run_id
      const lastRun = await prisma.run_session.findFirst({
        select: { run_id: true },
        orderBy: { run_id: "desc" },
      });

      await createNewRunSession(lastRun ? lastRun.run_id + 1 : 1, 1);
    });
  }

  async function incrementSession(): Promise<void> {
    await updateLastActive();

    await createNewRunSession(runId, sessionId + 1);
  }

  async function createNewRunSession(
    newRunId: number,
    newSessionId: number,
  ): Promise<void> {
    await usingDatabase(async (prisma) => {
      await prisma.run_session.create({
        data: {
          user_id: userId,
          run_id: newRunId,
          session_id: newSessionId,
          host_id: localHostId,
          model_name: agentConfig().shellModel,
          created_at: new Date().toISOString(),
          last_active: new Date().toISOString(),
        },
      });

      runId = newRunId;
      sessionId = newSessionId;
    });
  }

  async function updateLastActive(): Promise<void> {
    if (!userId) return;

    await usingDatabase(async (prisma) => {
      const now = new Date().toISOString();

      await prisma.run_session.updateMany({
        where: {
          user_id: userId,
          run_id: runId,
          session_id: sessionId,
        },
        data: { last_active: now },
      });

      // Also update user_notifications.last_active
      await prisma.user_notifications.updateMany({
        where: {
          user_id: userId,
        },
        data: { last_active: now },
      });
    });
  }

  function cleanup() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  return {
    cleanup,
    incrementSession,
    getUserId: () => userId,
    getRunId: () => runId,
    getSessionId: () => sessionId,
  };
}

export type RunService = Awaited<ReturnType<typeof createRunService>>;
