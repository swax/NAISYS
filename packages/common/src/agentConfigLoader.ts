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
  username: string;
  leadEntryIndex: number | undefined;
  config: AgentConfigFile;
}

/** Loads agent yaml configs from a file or directory path, returns a map of userId → UserEntry */
export function loadAgentConfigs(startupPath: string): Map<number, UserEntry> {
  const configEntries: ConfigEntry[] = [];
  const usernameToPath = new Map<string, string>();

  const resolvedPath = path.resolve(startupPath);

  if (fs.statSync(resolvedPath).isDirectory()) {
    processDirectory(resolvedPath, undefined, configEntries, usernameToPath);
  } else {
    processFile(resolvedPath, undefined, configEntries, usernameToPath);
  }

  // Add admin if not present
  const hasAdmin = configEntries.some(
    (e) => e.username === adminAgentConfig.username,
  );
  if (!hasAdmin) {
    configEntries.push({
      username: adminAgentConfig.username,
      leadEntryIndex: undefined,
      config: adminAgentConfig,
    });
  }

  // Build userId map (1-based sequential IDs)
  const userMap = new Map<number, UserEntry>();

  for (let i = 0; i < configEntries.length; i++) {
    const entry = configEntries[i];
    const userId = i + 1;
    const leadUserId =
      entry.leadEntryIndex !== undefined ? entry.leadEntryIndex + 1 : undefined;

    userMap.set(userId, {
      userId,
      username: entry.username,
      leadUserId,
      config: entry.config,
    });
  }

  return userMap;
}

function processDirectory(
  dirPath: string,
  leadEntryIndex: number | undefined,
  configEntries: ConfigEntry[],
  usernameToPath: Map<string, string>,
) {
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      processFile(
        path.join(dirPath, file),
        leadEntryIndex,
        configEntries,
        usernameToPath,
      );
    }
  }
}

function processFile(
  filePath: string,
  leadEntryIndex: number | undefined,
  configEntries: ConfigEntry[],
  usernameToPath: Map<string, string>,
) {
  const absolutePath = path.resolve(filePath);

  try {
    const configYaml = fs.readFileSync(absolutePath, "utf8");
    const configObj = yaml.load(configYaml);
    const agentConfig = AgentConfigFileSchema.parse(configObj);
    const username = agentConfig.username;

    // Check for duplicate usernames from different files
    const existingPath = usernameToPath.get(username);
    if (existingPath && existingPath !== absolutePath) {
      throw new Error(
        `Duplicate username "${username}" found in multiple files:\n  ${existingPath}\n  ${absolutePath}`,
      );
    }
    usernameToPath.set(username, absolutePath);

    const currentIndex = configEntries.length;

    configEntries.push({
      username,
      leadEntryIndex,
      config: agentConfig,
    });

    console.log(`Loaded user: ${username} from ${filePath}`);

    // Check for a subdirectory matching the filename (without extension)
    const ext = path.extname(absolutePath);
    const baseName = path.basename(absolutePath, ext);
    const subDir = path.join(path.dirname(absolutePath), baseName);

    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      processDirectory(subDir, currentIndex, configEntries, usernameToPath);
    }
  } catch (e) {
    throw new Error(`Failed to process agent config at ${filePath}: ${e}`);
  }
}
