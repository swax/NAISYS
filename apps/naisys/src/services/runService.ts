import { GlobalConfig } from "../globalConfig.js";
import { AgentConfig } from "../agentConfig.js";
import { DatabaseService } from "../services/dbService.js";

export async function createRunService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  { usingDatabase }: DatabaseService,
) {
  let userId = -1;

  /** The run ID of an agent process (there could be multiple runs for the same user). Globally unique */
  let runId = -1;

  /** The session number, incremented when the agent calls endsession */
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
    await usingDatabase(async (prisma) => {
      // If user is not in the db, add them
      const user = await prisma.users.findUnique({
        where: { username: agentConfig().username },
      });

      // If user not in database, add them
      if (!user) {
        try {
          const insertedUser = await prisma.users.create({
            data: {
              username: agentConfig().username,
              title: agentConfig().title,
              agent_path: agentConfig().hostpath,
              lead_username: agentConfig().leadAgent,
            },
          });

          userId = insertedUser.id;

          // Create user_notifications row for new user
          await prisma.user_notifications.create({
            data: {
              user_id: userId,
              latest_mail_id: -1,
              latest_log_id: -1,
              last_active: new Date().toISOString(),
            },
          });
        } catch (e) {
          throw (
            `A user already exists in the database with the agent path (${agentConfig().hostpath})\n` +
            `Either create a new agent config file, or delete the ${globalConfig().naisysFolder} folder to reset the database.`
          );
        }
      }
      // Else already exists, validate it's config path is correct
      else {
        userId = user.id;

        if (user.agent_path != agentConfig().hostpath) {
          throw `Error: User ${agentConfig().username} already exists in the database with a different config path (${user.agent_path})`;
        }

        if (
          agentConfig().leadAgent &&
          agentConfig().leadAgent != user.lead_username
        ) {
          throw `Error: User ${agentConfig().username} already exists in the database with a different lead agent (${user.lead_username})`;
        }

        // Update user title in database
        if (user.title !== agentConfig().title) {
          await prisma.users.update({
            where: { id: userId },
            data: { title: agentConfig().title },
          });
        }
      }
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
          model_name: agentConfig().shellModel,
          start_date: new Date().toISOString(),
          last_active: new Date().toISOString(),
        },
      });

      runId = newRunId;
      sessionId = newSessionId;
    });
  }

  async function updateLastActive(): Promise<void> {
    if (userId === -1) return;

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
