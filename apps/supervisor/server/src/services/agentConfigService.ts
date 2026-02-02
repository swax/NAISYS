import { ulid } from "@naisys/database";
import fs from "fs/promises";
import path from "path";
import { usingNaisysDb } from "../database/naisysDatabase.js";

/**
 * Resolve a user by username and host name.
 */
async function resolveUser(
  username: string,
  host: string,
): Promise<{ id: string; agent_path: string }> {
  return await usingNaisysDb(async (prisma) => {
    const user = await prisma.users.findFirst({
      where: {
        username,
        deleted_at: null,
      },
      select: { id: true, agent_path: true },
    });

    if (!user) {
      throw new Error(`User '${username}' not found on host '${host}'`);
    }

    return user;
  });
}

/**
 * Update the modified date on the user_notifications table
 */
async function updateUserNotificationModifiedDate(
  userId: string,
): Promise<void> {
  await usingNaisysDb(async (prisma) => {
    // Upsert the user_notifications record to update updated_at
    await prisma.user_notifications.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        updated_at: new Date(),
      },
      update: {
        updated_at: new Date(),
      },
    });
  });
}

/**
 * Get agent configuration YAML content for a specific user
 */
export async function getAgentConfig(
  username: string,
  host: string,
): Promise<{ config: string; path: string }> {
  const user = await resolveUser(username, host);

  // Read the agent config file
  try {
    const configContent = await fs.readFile(user.agent_path, "utf-8");
    return { config: configContent, path: user.agent_path };
  } catch (error) {
    throw new Error(
      `Failed to read agent configuration file at ${user.agent_path}`,
    );
  }
}

/**
 * Create a new agent with YAML config file and database entry
 */
export async function createAgentConfig(
  name: string,
  host: string,
): Promise<void> {
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
    return await prisma.users.findFirst({
      where: {
        username: name,
      },
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
`;

  // Write the YAML file
  await fs.writeFile(agentFilePath, yamlContent, "utf-8");

  // Add agent to the database
  const userId = ulid();
  await usingNaisysDb(async (prisma) => {
    await prisma.users.create({
      data: {
        id: userId,
        username: name,
        title: "Assistant",
        agent_path: agentFilePath,
      },
    });
  });

  // Update user notification modified date
  await updateUserNotificationModifiedDate(userId);
}

/**
 * Update agent configuration YAML content for a specific user
 */
export async function updateAgentConfig(
  username: string,
  config: string,
  host: string,
): Promise<void> {
  const user = await resolveUser(username, host);

  // Write the agent config file
  try {
    await fs.writeFile(user.agent_path, config, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to write agent configuration file at ${user.agent_path}`,
    );
  }

  // Update user notification modified date
  await updateUserNotificationModifiedDate(user.id);
}
