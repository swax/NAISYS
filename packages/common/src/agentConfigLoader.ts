import * as fs from "fs";
import yaml from "js-yaml";
import * as path from "path";
import {
  AgentConfigFile,
  AgentConfigFileSchema,
  UserEntry,
} from "./agentConfigFile.js";

/** Scans agent yaml files from a naisys folder and optional startup path, returns a map of username → UserEntry */
export function loadAgentConfigs(
  naisysFolder: string,
  startupAgentPath?: string,
): Map<string, UserEntry> {
  const users = new Map<string, UserEntry>();

  ensureAdminAgent(naisysFolder);

  // Load admin agent into map
  const adminAgentPath = path.join(naisysFolder, "agents", "admin_agent.yaml");
  const adminYaml = fs.readFileSync(adminAgentPath, "utf8");
  const adminConfig = AgentConfigFileSchema.parse(yaml.load(adminYaml));
  users.set(adminConfig.username, {
    config: adminConfig,
    agentPath: adminAgentPath,
    configYaml: adminYaml,
  });

  // Build queue of agent paths to process
  const agentQueue: { path: string; retryCount: number }[] = [];

  if (startupAgentPath) {
    agentQueue.push({ path: startupAgentPath, retryCount: 0 });
  }

  const naisysAgentsDir = path.join(naisysFolder, "agents");
  collectAgentPaths(naisysAgentsDir, agentQueue);

  // Process the queue with retry logic for agents with missing lead agents
  const processedFiles = new Set<string>();

  while (agentQueue.length > 0) {
    const item = agentQueue.shift()!;
    const result = processAgentConfig(
      item.path,
      processedFiles,
      users,
      agentQueue,
    );

    if (result === "lead_not_found") {
      if (item.retryCount >= 1) {
        throw new Error(
          `Failed to process agent config at ${item.path}: lead agent not found after retry. ` +
            `Check that the leadAgent username exists and is spelled correctly.`,
        );
      }
      agentQueue.push({ path: item.path, retryCount: item.retryCount + 1 });
    }
  }

  return users;
}

function ensureAdminAgent(naisysFolder: string) {
  const adminAgentPath = path.join(naisysFolder, "agents", "admin_agent.yaml");

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
      collectAgentPaths(fullPath, queue);
    } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      queue.push({ path: fullPath, retryCount: 0 });
    }
  }
}

function processAgentConfig(
  agentPath: string,
  processedFiles: Set<string>,
  users: Map<string, UserEntry>,
  agentQueue: { path: string; retryCount: number }[],
): "success" | "skipped" | "lead_not_found" {
  try {
    const absolutePath = path.resolve(agentPath);
    if (processedFiles.has(absolutePath)) {
      return "skipped";
    }

    const configYaml = fs.readFileSync(absolutePath, "utf8");
    const configObj = yaml.load(configYaml);
    const agentConfig = AgentConfigFileSchema.parse(configObj);

    // Check if lead agent exists in the users map
    if (agentConfig.leadAgent && !users.has(agentConfig.leadAgent)) {
      return "lead_not_found";
    }

    processedFiles.add(absolutePath);

    // Check for duplicate usernames from different files
    const existingEntry = users.get(agentConfig.username);
    if (existingEntry && existingEntry.agentPath !== absolutePath) {
      throw new Error(
        `Duplicate username "${agentConfig.username}" found in multiple files:\n  ${existingEntry.agentPath}\n  ${absolutePath}`,
      );
    }

    users.set(agentConfig.username, {
      config: agentConfig,
      agentPath: absolutePath,
      configYaml,
    });

    console.log(`Loaded user: ${agentConfig.username} from ${agentPath}`);

    // Collect subagent directory paths
    if (agentConfig.subagentDirectory) {
      const agentDir = path.dirname(absolutePath);
      const subagentDir = path.resolve(agentDir, agentConfig.subagentDirectory);
      collectAgentPaths(subagentDir, agentQueue);
    }

    return "success";
  } catch (e) {
    throw new Error(`Failed to process agent config at ${agentPath}: ${e}`);
  }
}
