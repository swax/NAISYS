import * as crypto from "crypto";
import * as fs from "fs";
import yaml from "js-yaml";
import * as path from "path";
import { AgentConfigFileSchema, UserEntry } from "./agentConfigFile.js";

/** Loads agent yaml configs from a file or directory path, returns a map of userId → UserEntry */
export function loadAgentConfigs(startupPath: string): Map<string, UserEntry> {
  const userMap = new Map<string, UserEntry>();
  const usernameToPath = new Map<string, string>();

  const resolvedPath = path.resolve(startupPath);

  if (fs.statSync(resolvedPath).isDirectory()) {
    processDirectory(resolvedPath, undefined, userMap, usernameToPath);
  } else {
    processFile(resolvedPath, undefined, userMap, usernameToPath);
  }

  return userMap;
}

function processDirectory(
  dirPath: string,
  leadUserId: string | undefined,
  userMap: Map<string, UserEntry>,
  usernameToPath: Map<string, string>,
) {
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      processFile(
        path.join(dirPath, file),
        leadUserId,
        userMap,
        usernameToPath,
      );
    }
  }
}

function processFile(
  filePath: string,
  leadUserId: string | undefined,
  userMap: Map<string, UserEntry>,
  usernameToPath: Map<string, string>,
) {
  const absolutePath = path.resolve(filePath);

  try {
    const configYaml = fs.readFileSync(absolutePath, "utf8");
    const configObj = yaml.load(configYaml);
    const agentConfig = AgentConfigFileSchema.parse(configObj);

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
    const existingPath = usernameToPath.get(agentConfig.username);
    if (existingPath && existingPath !== absolutePath) {
      throw new Error(
        `Duplicate username "${agentConfig.username}" found in multiple files:\n  ${existingPath}\n  ${absolutePath}`,
      );
    }
    usernameToPath.set(agentConfig.username, absolutePath);

    if (userMap.has(agentConfig._id)) {
      throw new Error(
        `Duplicate user ID "${agentConfig._id}" found in multiple files:\n  ${
          userMap.get(agentConfig._id)!.agentPath
        }\n  ${absolutePath}`,
      );
    }

    userMap.set(agentConfig._id, {
      userId: agentConfig._id,
      config: agentConfig,
      leadUserId,
      agentPath: absolutePath,
    });

    console.log(`Loaded user: ${agentConfig.username} from ${filePath}`);

    // Check for a subdirectory matching the filename (without extension)
    const ext = path.extname(absolutePath);
    const baseName = path.basename(absolutePath, ext);
    const subDir = path.join(path.dirname(absolutePath), baseName);

    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      processDirectory(subDir, agentConfig._id, userMap, usernameToPath);
    }
  } catch (e) {
    throw new Error(`Failed to process agent config at ${filePath}: ${e}`);
  }
}
