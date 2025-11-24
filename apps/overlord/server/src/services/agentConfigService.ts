import fs from "fs/promises";
import path from "path";
import { usingNaisysDb } from "../database/naisysDatabase.js";

/**
 * Get agent configuration YAML content for a specific user
 */
export async function getAgentConfig(username: string): Promise<string> {
  // Look up the user in the database
  const user = await usingNaisysDb(async (prisma) => {
    return await prisma.users.findUnique({
      where: { username },
      select: { agent_path: true },
    });
  });

  if (!user) {
    throw new Error(`User '${username}' not found`);
  }

  // Read the agent config file
  try {
    const configContent = await fs.readFile(user.agent_path, "utf-8");
    return configContent;
  } catch (error) {
    throw new Error(
      `Failed to read agent configuration file at ${user.agent_path}`,
    );
  }
}

/**
 * Create a new agent with YAML config file and database entry
 */
export async function createAgentConfig(name: string): Promise<void> {
  const naisysFolder = process.env.NAISYS_FOLDER;
  if (!naisysFolder) {
    throw new Error("NAISYS_FOLDER environment variable is not set");
  }

  const agentsFolder = path.join(naisysFolder, "agents");
  const agentFilePath = path.join(agentsFolder, `${name}.yaml`);

  // Create agents folder if it doesn't exist
  await fs.mkdir(agentsFolder, { recursive: true });

  // Check if agent file already exists
  try {
    await fs.access(agentFilePath);
    throw new Error(`Agent '${name}' already exists`);
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  // Check db if username already exists
  const existingAgent = await usingNaisysDb(async (prisma) => {
    return await prisma.users.findUnique({
      where: { username: name },
    });
  });

  if (existingAgent) {
    throw new Error(`Agent '${name}' already exists in the database`);
  }

  // Create default YAML content
  const yamlContent = `username: ${name}
title: Assistant
shellModel: none
agentPrompt: |
  You are \${name} a \${title} with the job of helping out the admin with what he wants to do.
tokenMax: 20000
debugPauseSeconds: 5
webEnabled: true
mailEnabled: true
wakeOnMessage: true
`;

  // Write the YAML file
  await fs.writeFile(agentFilePath, yamlContent, "utf-8");

  // Add agent to the database
  await usingNaisysDb(async (prisma) => {
    await prisma.users.create({
      data: {
        username: name,
        title: "Assistant",
        agent_path: agentFilePath,
      },
    });
  });
}

/**
 * Update agent configuration YAML content for a specific user
 */
export async function updateAgentConfig(
  username: string,
  config: string,
): Promise<void> {
  // Look up the user in the database
  const user = await usingNaisysDb(async (prisma) => {
    return await prisma.users.findUnique({
      where: { username },
      select: { agent_path: true },
    });
  });

  if (!user) {
    throw new Error(`User '${username}' not found`);
  }

  // Write the agent config file
  try {
    await fs.writeFile(user.agent_path, config, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to write agent configuration file at ${user.agent_path}`,
    );
  }
}
