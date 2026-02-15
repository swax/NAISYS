import * as crypto from "crypto";
import * as fs from "fs";
import yaml from "js-yaml";
import * as path from "path";
import {
  adminAgentConfig,
  AgentConfigFile,
  AgentConfigFileSchema,
  UserEntry,
} from "./agentConfigFile.js";

interface ConfigEntry {
  configId: string;
  username: string;
  agentPath?: string;
  leadConfigId?: string;
  config: AgentConfigFile;
}

/** Loads agent yaml configs from a file or directory path, returns a map of userId → UserEntry */
export function loadAgentConfigs(startupPath: string): Map<number, UserEntry> {
  const configEntries: ConfigEntry[] = [];
  const usernameToPath = new Map<string, string>();
  const configIdSet = new Set<string>();

  const resolvedPath = path.resolve(startupPath);

  if (fs.statSync(resolvedPath).isDirectory()) {
    processDirectory(
      resolvedPath,
      undefined,
      configEntries,
      usernameToPath,
      configIdSet,
    );
  } else {
    processFile(
      resolvedPath,
      undefined,
      configEntries,
      usernameToPath,
      configIdSet,
    );
  }

  // Add admin if not present
  const hasAdmin = configEntries.some(
    (e) => e.username === adminAgentConfig.username,
  );
  if (!hasAdmin) {
    configEntries.push({
      configId: adminAgentConfig._id!,
      username: adminAgentConfig.username,
      config: adminAgentConfig,
    });
  }

  // First pass: assign sequential IDs and build configId → userId mapping
  const configIdToUserId = new Map<string, number>();
  const userMap = new Map<number, UserEntry>();
  let nextId = 1;

  for (const entry of configEntries) {
    const userId = nextId++;
    configIdToUserId.set(entry.configId, userId);

    userMap.set(userId, {
      userId,
      username: entry.username,
      configId: entry.configId,
      config: entry.config,
      agentPath: entry.agentPath,
    });
  }

  // Second pass: resolve lead relationships by configId → userId
  for (const entry of configEntries) {
    if (entry.leadConfigId) {
      const userId = configIdToUserId.get(entry.configId)!;
      const leadUserId = configIdToUserId.get(entry.leadConfigId);
      if (leadUserId !== undefined) {
        userMap.get(userId)!.leadUserId = leadUserId;
      }
    }
  }

  return userMap;
}

function processDirectory(
  dirPath: string,
  leadConfigId: string | undefined,
  configEntries: ConfigEntry[],
  usernameToPath: Map<string, string>,
  configIdSet: Set<string>,
) {
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      processFile(
        path.join(dirPath, file),
        leadConfigId,
        configEntries,
        usernameToPath,
        configIdSet,
      );
    }
  }
}

function processFile(
  filePath: string,
  leadConfigId: string | undefined,
  configEntries: ConfigEntry[],
  usernameToPath: Map<string, string>,
  configIdSet: Set<string>,
) {
  const absolutePath = path.resolve(filePath);

  try {
    const configYaml = fs.readFileSync(absolutePath, "utf8");
    const configObj = yaml.load(configYaml);
    const agentConfig = AgentConfigFileSchema.parse(configObj);
    const username = agentConfig.username;

    // Generate and persist _id if not set
    if (!agentConfig._id) {
      agentConfig._id = crypto.randomUUID();
      fs.writeFileSync(
        absolutePath,
        `_id: ${agentConfig._id}\n${configYaml}`,
        "utf8",
      );
    }

    // Check for duplicate usernames from different files
    const existingPath = usernameToPath.get(username);
    if (existingPath && existingPath !== absolutePath) {
      throw new Error(
        `Duplicate username "${username}" found in multiple files:\n  ${existingPath}\n  ${absolutePath}`,
      );
    }
    usernameToPath.set(username, absolutePath);

    if (configIdSet.has(agentConfig._id)) {
      throw new Error(
        `Duplicate config ID "${agentConfig._id}" found in multiple files`,
      );
    }
    configIdSet.add(agentConfig._id);

    configEntries.push({
      configId: agentConfig._id,
      username,
      agentPath: absolutePath,
      leadConfigId,
      config: agentConfig,
    });

    console.log(`Loaded user: ${username} from ${filePath}`);

    // Check for a subdirectory matching the filename (without extension)
    const ext = path.extname(absolutePath);
    const baseName = path.basename(absolutePath, ext);
    const subDir = path.join(path.dirname(absolutePath), baseName);

    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      processDirectory(
        subDir,
        agentConfig._id,
        configEntries,
        usernameToPath,
        configIdSet,
      );
    }
  } catch (e) {
    throw new Error(`Failed to process agent config at ${filePath}: ${e}`);
  }
}
