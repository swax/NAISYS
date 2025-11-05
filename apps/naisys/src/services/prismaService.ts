import { createPrismaClient } from "@naisys/database";
import { createConfig } from "../config.js";

export async function createPrismaService(
  config: Awaited<ReturnType<typeof createConfig>>,
) {
  const databasePath = config.dbFilePath.toHostPath();
  const prisma = createPrismaClient(databasePath);

  let myUserId = -1;
  let updateInterval: NodeJS.Timeout | null = null;

  // Initialize user
  await initUser();

  async function initUser() {
    // If user is not in the db, add them
    const user = await prisma.users.findUnique({
      where: { username: config.agent.username },
    });

    // If user not in database, add them
    if (!user) {
      try {
        const insertedUser = await prisma.users.create({
          data: {
            username: config.agent.username,
            title: config.agent.title,
            agent_path: config.agent.hostpath,
            lead_username: config.agent.leadAgent,
          },
        });

        myUserId = insertedUser.id;
      } catch (e) {
        throw (
          `A user already exists in the database with the agent path (${config.agent.hostpath})\n` +
          `Either create a new agent config file, or delete the ${config.naisysFolder} folder to reset the database.`
        );
      }
    }
    // Else already exists, validate it's config path is correct
    else {
      myUserId = user.id;

      if (user.agent_path != config.agent.hostpath) {
        throw `Error: User ${config.agent.username} already exists in the database with a different config path (${user.agent_path})`;
      }

      if (
        config.agent.leadAgent &&
        config.agent.leadAgent != user.lead_username
      ) {
        throw `Error: User ${config.agent.username} already exists in the database with a different lead agent (${user.lead_username})`;
      }

      // Update user title in database
      if (user.title !== config.agent.title) {
        await prisma.users.update({
          where: { id: myUserId },
          data: { title: config.agent.title },
        });
      }
    }

    // Start the last_active updater after user is initialized
    updateLastActive();
    updateInterval = setInterval(updateLastActive, 2000);
  }

  async function updateLastActive(): Promise<void> {
    if (myUserId === -1) return;

    try {
      await prisma.users.update({
        where: { id: myUserId },
        data: { last_active: new Date().toISOString() },
      });
    } catch (error) {
      console.error("Error updating last_active:", error);
    }
  }

  function cleanup() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  return {
    prisma,
    myUserId,
    cleanup,
  };
}
