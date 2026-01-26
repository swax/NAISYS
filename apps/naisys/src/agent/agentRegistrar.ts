import { DatabaseService, ulid } from "@naisys/database";
import * as fs from "fs";
import yaml from "js-yaml";
import * as path from "path";
import { GlobalConfig } from "../globalConfig.js";
import { HostService } from "../services/hostService.js";
import { AgentConfigFile, AgentConfigFileSchema } from "./agentConfig.js";

/** Pre-loads agents into the database without having to start each one up individually to make it available */
export async function createAgentRegistrar(
  { globalConfig }: GlobalConfig,
  { usingDatabase }: DatabaseService,
  hostService: HostService,
  startupAgentPath?: string,
) {
  const { localHostId } = hostService;
  await reloadAgents();

  async function reloadAgents() {
    // Load all existing users from database into memory (filtered by host)
    const existingUsers = await usingDatabase(async (prisma) => {
      return await prisma.users.findMany({
        where: { host_id: localHostId },
      });
    });

    // Convert to a Map for easy lookup by username
    const userMap = new Map(existingUsers.map((u) => [u.username, u]));

    // Track which users were processed (created or updated) and their file paths
    const processedUsernames = new Map<string, string>();

    // Track processed files to avoid duplicates
    const processedFiles = new Set<string>();

    createAdminAgent();

    // Collect all agent config paths to process
    const agentQueue: { path: string; retryCount: number }[] = [];

    // Load agent from startup path
    if (startupAgentPath) {
      agentQueue.push({ path: startupAgentPath, retryCount: 0 });
    }

    // Load from naisys path/agents
    const naisysFolder = globalConfig().naisysFolder;
    if (!naisysFolder) {
      throw new Error("naisysFolder is not configured in globalConfig");
    }

    const naisysAgentsDir = path.join(naisysFolder, "agents");
    collectAgentPaths(naisysAgentsDir, agentQueue);

    // Process the queue with retry logic for agents with missing lead agents
    while (agentQueue.length > 0) {
      const item = agentQueue.shift()!;
      const result = await processAgentConfig(
        item.path,
        processedFiles,
        userMap,
        processedUsernames,
        agentQueue,
      );

      if (result === "lead_not_found") {
        if (item.retryCount >= 1) {
          throw new Error(
            `Failed to process agent config at ${item.path}: lead agent not found after retry. ` +
              `Check that the leadAgent username exists and is spelled correctly.`,
          );
        }
        // Put back in queue with incremented retry count
        agentQueue.push({ path: item.path, retryCount: item.retryCount + 1 });
      }
    }

    // Check for users that weren't created/updated
    for (const [username, user] of userMap) {
      if (!processedUsernames.has(username)) {
        // Check if agent path exists
        if (!fs.existsSync(user.agent_path)) {
          // Create recovered agent file using original filename
          const originalFilename = path.basename(user.agent_path);
          const ext = path.extname(originalFilename);
          const baseName = path.basename(originalFilename, ext);
          const recoveredFilename = `${baseName}-recovered${ext}`;
          const recoveredPath = path.join(
            naisysFolder,
            "agents",
            recoveredFilename,
          );

          // Ensure the agents directory exists
          const agentsDir = path.join(naisysFolder, "agents");
          if (!fs.existsSync(agentsDir)) {
            fs.mkdirSync(agentsDir, { recursive: true });
          }

          fs.writeFileSync(recoveredPath, user.config);

          // Update database with new path
          await usingDatabase(async (prisma) => {
            await prisma.users.update({
              where: { username_host_id: { username, host_id: localHostId } },
              data: { agent_path: recoveredPath },
            });
          });

          console.log(
            `Recovered missing agent ${username} to: ${recoveredPath}`,
          );
        }
      }
    }
  }

  /**
   * Admin agent is a human operated agent
   * The ns-talk command uses this agent name as the sender, so agents will llmail reply to it
   * A quiet console environment to monitor agents, send/recv mail from them
   * Allows restarting the an agent without ending the naisys process since the admin is still running
   * (todo:) Allows other agents to run at full speed (0s timeout), and only slow down when in focus
   */
  function createAdminAgent() {
    // Create an admin agent in the naisys folder if it doesn't exist
    const naisysFolder = globalConfig().naisysFolder;
    if (!naisysFolder) {
      throw new Error("naisysFolder is not configured in globalConfig");
    }

    const adminAgentPath = path.join(
      naisysFolder,
      "agents",
      "admin_agent.yaml",
    );

    if (fs.existsSync(adminAgentPath)) {
      return;
    }
    const adminAgentConfig = {
      username: "admin",
      title: "Administrator",
      shellModel: "none",
      agentPrompt: "Admin agent for monitoring and control.",
      tokenMax: 100_000,
    } satisfies AgentConfigFile;

    const yamlContent = yaml.dump(adminAgentConfig);

    // Ensure the agents directory exists
    const agentsDir = path.join(naisysFolder, "agents");
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    fs.writeFileSync(adminAgentPath, yamlContent);

    console.log(`Created admin agent config at: ${adminAgentPath}`);
  }

  function collectAgentPaths(
    dirPath: string,
    queue: { path: string; retryCount: number }[],
  ) {
    if (!fs.existsSync(dirPath)) {
      console.log(`Directory not found, skipping: ${dirPath}`);
      return;
    }

    if (!fs.statSync(dirPath).isDirectory()) {
      console.warn(`Not a directory, skipping: ${dirPath}`);
      return;
    }

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Recursively collect from subdirectory
        collectAgentPaths(fullPath, queue);
      } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        queue.push({ path: fullPath, retryCount: 0 });
      }
    }
  }

  async function processAgentConfig(
    agentPath: string,
    processedFiles: Set<string>,
    userMap: Map<string, any>,
    processedUsernames: Map<string, string>,
    agentQueue: { path: string; retryCount: number }[],
  ): Promise<"success" | "skipped" | "lead_not_found"> {
    try {
      // Get absolute path and check if already processed
      const absolutePath = path.resolve(agentPath);
      if (processedFiles.has(absolutePath)) {
        // console.log(`Skipping already processed agent config: ${absolutePath}`);
        return "skipped";
      }

      const configYaml = fs.readFileSync(absolutePath, "utf8");
      const configObj = yaml.load(configYaml);
      const agentConfig = AgentConfigFileSchema.parse(configObj);

      // Check if lead agent exists before processing
      if (agentConfig.leadAgent) {
        // Check both userMap (already processed) and database (pre-existing)
        const leadInMap = userMap.has(agentConfig.leadAgent);
        if (!leadInMap) {
          const leadInDb = await usingDatabase(async (prisma) => {
            return await prisma.users.findFirst({
              where: {
                username: agentConfig.leadAgent,
                host_id: localHostId,
              },
              select: { id: true },
            });
          });
          if (!leadInDb) {
            // Lead agent not found, defer processing
            return "lead_not_found";
          }
        }
      }

      // Mark as processed (only after we know we can proceed)
      processedFiles.add(absolutePath);

      // Check if username already processed from a different file
      const previousPath = processedUsernames.get(agentConfig.username);
      if (previousPath && previousPath !== absolutePath) {
        throw new Error(
          `Duplicate username "${agentConfig.username}" found in multiple files:\n  ${previousPath}\n  ${absolutePath}`,
        );
      }

      // Mark username as processed
      processedUsernames.set(agentConfig.username, absolutePath);

      const existingUser = userMap.get(agentConfig.username);

      let createdOrUpdatedUser = false;

      await usingDatabase(async (prisma) => {
        // Resolve lead agent username to user ID if specified
        let leadUserId: string | null = null;
        if (agentConfig.leadAgent) {
          const leadUser = await prisma.users.findFirst({
            where: {
              username: agentConfig.leadAgent,
              host_id: localHostId,
            },
            select: { id: true },
          });
          leadUserId = leadUser?.id ?? null;
        }

        if (!existingUser) {
          // User doesn't exist, create it
          const user = await prisma.users.create({
            data: {
              id: ulid(),
              username: agentConfig.username,
              title: agentConfig.title,
              agent_path: absolutePath,
              lead_user_id: leadUserId,
              config: configYaml,
              host_id: localHostId,
            },
          });

          console.log(
            `Created user: ${agentConfig.username} from ${agentPath}`,
          );

          // Add to map for future lookups
          userMap.set(agentConfig.username, user);

          // Ensure user_notifications exists
          await prisma.user_notifications.create({
            data: {
              user_id: user.id,
              host_id: localHostId,
              latest_log_id: "",
            },
          });

          createdOrUpdatedUser = true;
        } else {
          // User exists, compare fields
          const changes: string[] = [];

          if (existingUser.title !== agentConfig.title) {
            changes.push(
              `title: "${existingUser.title}" -> "${agentConfig.title}"`,
            );
          }
          if (existingUser.agent_path !== absolutePath) {
            changes.push(
              `agent_path: "${existingUser.agent_path}" -> "${absolutePath}"`,
            );
          }
          if (existingUser.lead_user_id !== leadUserId) {
            changes.push(
              `lead_user_id: "${existingUser.lead_user_id}" -> "${leadUserId}"`,
            );
          }
          if (existingUser.config !== configYaml) {
            changes.push(`config: updated`);
          }

          if (changes.length > 0) {
            console.log(
              `Updated user ${agentConfig.username}: ${changes.join(", ")} from ${agentPath}`,
            );

            await prisma.users.update({
              where: {
                username_host_id: {
                  username: agentConfig.username,
                  host_id: localHostId,
                },
              },
              data: {
                title: agentConfig.title,
                agent_path: absolutePath,
                lead_user_id: leadUserId,
                config: configYaml,
              },
            });

            createdOrUpdatedUser = true;

            // Update the userMap with new values
            userMap.set(agentConfig.username, {
              ...existingUser,
              title: agentConfig.title,
              agent_path: absolutePath,
              lead_user_id: leadUserId,
              config: configYaml,
            });
          }

          // Ensure user_notifications exists (create only if it doesn't)
          if (createdOrUpdatedUser) {
            await prisma.user_notifications.upsert({
              where: { user_id: existingUser.id },
              create: {
                user_id: existingUser.id,
                host_id: localHostId,
                latest_log_id: "",
              },
              update: {
                updated_at: new Date().toISOString(),
              },
            });
          }
        }
      });

      // Collect subagent directory paths to process later
      if (agentConfig.subagentDirectory) {
        const agentDir = path.dirname(absolutePath);
        const subagentDir = path.resolve(
          agentDir,
          agentConfig.subagentDirectory,
        );
        collectAgentPaths(subagentDir, agentQueue);
      }

      return "success";
    } catch (e) {
      // Need to throw or runService startup will fail
      throw new Error(`Failed to process agent config at ${agentPath}: ${e}`);
    }
  }

  async function getStartupUserId(agentPath?: string): Promise<string> {
    const user = await usingDatabase(async (prisma) => {
      if (agentPath) {
        const absolutePath = path.resolve(agentPath);
        return await prisma.users.findFirst({
          where: {
            agent_path: absolutePath,
            host_id: localHostId,
          },
        });
      } else {
        // No path provided, return admin user
        return await prisma.users.findFirst({
          where: {
            username: "admin",
            host_id: localHostId,
          },
        });
      }
    });

    if (!user) {
      throw new Error(
        agentPath
          ? `No user found for agent path: ${path.resolve(agentPath)}`
          : `Admin user not found`,
      );
    }

    return user.id;
  }

  return {
    reloadAgents,
    getStartupUserId,
  };
}

export type AgentRegistrar = Awaited<ReturnType<typeof createAgentRegistrar>>;
