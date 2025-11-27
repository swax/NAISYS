import * as fs from "fs";
import yaml from "js-yaml";
import * as path from "path";
import { AgentConfigFileSchema } from "./agentConfig.js";
import { GlobalConfig } from "./globalConfig.js";
import { DatabaseService } from "./services/dbService.js";

/** Pre-loads agents into the database without having to start each one up individually to make it available */
export async function createAgentRegistrar(
  { globalConfig }: GlobalConfig,
  { usingDatabase }: DatabaseService,
  startupAgentPath?: string,
) {
  await reloadAgents();

  async function reloadAgents() {
    // Track processed files to avoid duplicates
    const processedFiles = new Set<string>();

    // Load agent from startup path
    if (startupAgentPath) {
      await processAgentConfig(startupAgentPath, processedFiles);
    }

    // Load from naisys path/agents
    const naisysFolder = globalConfig().naisysFolder;

    if (naisysFolder) {
      const naisysAgentsDir = path.join(naisysFolder, "agents");
      await processDirectory(naisysAgentsDir, processedFiles);
    }
  }

  async function processAgentConfig(
    agentPath: string,
    processedFiles: Set<string>,
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

      const rawConfig = yaml.load(fs.readFileSync(absolutePath, "utf8"));

      const agentConfig = AgentConfigFileSchema.parse(rawConfig);

      await usingDatabase(async (prisma) => {
        // Upsert user: create if doesn't exist, update if it does
        const user = await prisma.users.upsert({
          where: { username: agentConfig.username },
          create: {
            username: agentConfig.username,
            title: agentConfig.title,
            agent_path: absolutePath,
            lead_username: agentConfig.leadAgent,
          },
          update: {
            title: agentConfig.title,
            agent_path: absolutePath,
            lead_username: agentConfig.leadAgent,
          },
        });

        // Ensure user_notifications exists (create only if it doesn't)
        await prisma.user_notifications.upsert({
          where: { user_id: user.id },
          create: {
            user_id: user.id,
            latest_mail_id: -1,
            latest_log_id: -1,
          },
          update: {},
        });
      });

      console.log(
        `Registered agent ${agentConfig.username} from config: ${absolutePath}`,
      );

      // Process subagent directory recursively
      if (agentConfig.subagentDirectory) {
        const agentDir = path.dirname(absolutePath);
        const subagentDir = path.resolve(
          agentDir,
          agentConfig.subagentDirectory,
        );
        await processDirectory(subagentDir, processedFiles);
      }
    } catch (e) {
      // Need to throw or runService startup will fail
      throw new Error(`Failed to process agent config at ${agentPath}: ${e}`);
    }
  }

  async function processDirectory(
    dirPath: string,
    processedFiles: Set<string>,
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
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const agentPath = path.join(dirPath, file);
          await processAgentConfig(agentPath, processedFiles);
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
