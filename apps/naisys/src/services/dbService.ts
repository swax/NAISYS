import { createPrismaClient } from "@naisys/database";
import { createConfig } from "../config.js";
import * as pathService from "./pathService.js";
import { PrismaClient } from "@naisys/database";
import { exec } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const execAsync = promisify(exec);

export async function createDatabaseService(
  config: Awaited<ReturnType<typeof createConfig>>,
) {
  let myUserId = -1;
  let updateInterval: NodeJS.Timeout | null = null;

  // Ensure database directory exists
  pathService.ensureFileDirExists(config.dbFilePath);

  const databasePath = config.dbFilePath.toHostPath();
  const prisma = createPrismaClient(databasePath);

  await initDatabase();

  async function initDatabase() {
    // Run migrations to create database schema if it doesn't exist
    await runMigrations();

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

  async function runMigrations(): Promise<void> {
    try {
      // Check if database needs initialization by checking if users table exists
      let needsInit = false;
      try {
        await prisma.$queryRaw`SELECT 1 FROM users LIMIT 1`;
      } catch (error) {
        // Table doesn't exist, need to run migrations
        needsInit = true;
      }

      if (!needsInit) {
        return; // Database already initialized
      }

      console.log("Initializing database...");

      // Find the @naisys/database package location
      const databasePackageUrl = import.meta.resolve("@naisys/database");
      const databasePackagePath = fileURLToPath(databasePackageUrl);
      const databasePackageDir = dirname(dirname(databasePackagePath));
      const schemaPath = join(databasePackageDir, "prisma", "schema.prisma");

      // Run Prisma migrations from the database package directory
      const { stdout, stderr } = await execAsync(
        `npx prisma migrate deploy --schema="${schemaPath}"`,
        {
          cwd: databasePackageDir,
          env: {
            ...process.env,
            DATABASE_URL: `file:${databasePath}`,
          },
        },
      );

      if (stdout) console.log(stdout);
      if (stderr && !stderr.includes("Loaded Prisma config")) {
        console.error(stderr);
      }
    } catch (error) {
      console.error("Error running migrations:", error);
      throw error;
    }
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

  async function usingDatabase<T>(
    run: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return await run(prisma);
  }

  function cleanup() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  return {
    myUserId,
    usingDatabase,
    cleanup,
  };
}
