import { ulid } from "@naisys/database";
import * as fs from "fs";
import yaml from "js-yaml";
import * as path from "path";
import { AgentConfigFile, AgentConfigFileSchema } from "./agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { DatabaseService } from "@naisys/database";
import { HostService } from "../services/hostService.js";

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

    // Load agent from startup path
    if (startupAgentPath) {
      await processAgentConfig(
        startupAgentPath,
        processedFiles,
        userMap,
        processedUsernames,
      );
    }

    // Load from naisys path/agents
    const naisysFolder = globalConfig().naisysFolder;
    if (!naisysFolder) {
      throw new Error("naisysFolder is not configured in globalConfig");
    }

    const naisysAgentsDir = path.join(naisysFolder, "agents");
    await processDirectory(
      naisysAgentsDir,
      processedFiles,
      userMap,
      processedUsernames,
    );

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
              where: { username },
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
   * The talk command uses this agent name as the sender, so agents will llmail reply to it
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

  async function processAgentConfig(
    agentPath: string,
    processedFiles: Set<string>,
    userMap: Map<string, any>,
    processedUsernames: Map<string, string>,
  ) {
    try {
      // Get absolute path and check if already processed
      const absolutePath = path.resolve(agentPath);
      if (processedFiles.has(absolutePath)) {
        console.log(`Skipping already processed agent config: ${absolutePath}`);
        return;
      }

      // Mark as processed
      processedFiles.add(absolutePath);

      const configYaml = fs.readFileSync(absolutePath, "utf8");
      const configObj = yaml.load(configYaml);
      const agentConfig = AgentConfigFileSchema.parse(configObj);

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
        if (!existingUser) {
          // Check if user actually does exists, but with a different host
          const userOnAnotherHost = await prisma.users.findUnique({
            where: { username: agentConfig.username },
            select: {
              host_id: true,
              host: {
                select: {
                  name: true,
                },
              },
            },
          });

          if (userOnAnotherHost) {
            throw new Error(
              `User "${agentConfig.username}" already exists in database from a different host (${userOnAnotherHost.host?.name}). Cannot create duplicate usernames across hosts.`
            );
          }

          // User doesn't exist, create it
          const user = await prisma.users.create({
            data: {
              id: ulid(),
              username: agentConfig.username,
              title: agentConfig.title,
              agent_path: absolutePath,
              lead_username: agentConfig.leadAgent ?? null,
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
              latest_mail_id: "",
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
          if (existingUser.lead_username !== (agentConfig.leadAgent ?? null)) {
            changes.push(
              `lead_username: "${existingUser.lead_username}" -> "${agentConfig.leadAgent ?? null}"`,
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
              where: { username: agentConfig.username },
              data: {
                title: agentConfig.title,
                agent_path: absolutePath,
                lead_username: agentConfig.leadAgent ?? null,
                config: configYaml,
              },
            });

            createdOrUpdatedUser = true;

            // Update the userMap with new values
            userMap.set(agentConfig.username, {
              ...existingUser,
              title: agentConfig.title,
              agent_path: absolutePath,
              lead_username: agentConfig.leadAgent ?? null,
              config: configYaml,
            });
          }

          // Ensure user_notifications exists (create only if it doesn't)
          if (createdOrUpdatedUser) {
            await prisma.user_notifications.upsert({
              where: { user_id: existingUser.id },
              create: {
                user_id: existingUser.id,
                latest_mail_id: "",
                latest_log_id: "",
              },
              update: {
                updated_at: new Date().toISOString(),
              },
            });
          }
        }
      });

      // Process subagent directory recursively
      if (agentConfig.subagentDirectory) {
        const agentDir = path.dirname(absolutePath);
        const subagentDir = path.resolve(
          agentDir,
          agentConfig.subagentDirectory,
        );
        await processDirectory(
          subagentDir,
          processedFiles,
          userMap,
          processedUsernames,
        );
      }
    } catch (e) {
      // Need to throw or runService startup will fail
      throw new Error(`Failed to process agent config at ${agentPath}: ${e}`);
    }
  }

  async function processDirectory(
    dirPath: string,
    processedFiles: Set<string>,
    userMap: Map<string, any>,
    processedUsernames: Map<string, string>,
  ) {
    try {
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
          // Recursively process subdirectory
          await processDirectory(
            fullPath,
            processedFiles,
            userMap,
            processedUsernames,
          );
        } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          // Process yaml file
          await processAgentConfig(
            fullPath,
            processedFiles,
            userMap,
            processedUsernames,
          );
        }
      }
    } catch (e) {
      throw new Error(`Failed to process directory ${dirPath}: ${e}`);
    }
  }

  return {
    reloadAgents,
  };
}

export type AgentRegistrar = Awaited<ReturnType<typeof createAgentRegistrar>>;
