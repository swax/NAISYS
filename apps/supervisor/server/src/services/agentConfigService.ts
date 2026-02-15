import { AgentConfigFile, AgentConfigFileSchema } from "@naisys/common";
import fs from "fs/promises";
import yaml from "js-yaml";
import { usingNaisysDb } from "../database/naisysDatabase.js";
import { sendUserListChanged } from "./hubConnectionService.js";

/**
 * Update the modified date on the user_notifications table
 */
async function updateUserNotificationModifiedDate(
  userId: number,
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
 * Create a new agent with database entry (no YAML file).
 */
export async function createAgentConfig(name: string): Promise<void> {
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
spendLimitDollars: 1
tokenMax: 20000
debugPauseSeconds: 5
webEnabled: true
`;

  // Add agent to the database, let DB autoincrement
  const user = await usingNaisysDb(async (prisma) => {
    return await prisma.users.create({
      data: {
        uuid: crypto.randomUUID(),
        username: name,
        title: "Assistant",
        agent_path: null,
        config: yamlContent,
      },
    });
  });

  // Update user notification modified date
  await updateUserNotificationModifiedDate(user.id);

  // Notify hub to broadcast updated user list to all NAISYS clients
  sendUserListChanged();
}

/**
 * Resolve a user by ID.
 */
async function resolveUserById(
  id: number,
): Promise<{ id: number; agent_path: string | null }> {
  return await usingNaisysDb(async (prisma) => {
    const user = await prisma.users.findUnique({
      where: { id },
      select: { id: true, agent_path: true },
    });

    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }

    return user;
  });
}

/**
 * Get parsed agent configuration by user ID. Reads from DB config column.
 */
export async function getAgentConfigById(id: number): Promise<AgentConfigFile> {
  const configStr = await usingNaisysDb(async (prisma) => {
    const user = await prisma.users.findUnique({
      where: { id },
      select: { config: true },
    });

    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }

    return user.config;
  });

  const parsed = yaml.load(configStr);
  return AgentConfigFileSchema.parse(parsed);
}

/**
 * Build config object in canonical field order for readable YAML output.
 */
function canonicalConfigOrder(
  config: AgentConfigFile,
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};

  // Identity
  if (config._id !== undefined) ordered._id = config._id;
  ordered.username = config.username;
  ordered.title = config.title;

  // Prompt
  ordered.agentPrompt = config.agentPrompt;

  // Models
  ordered.shellModel = config.shellModel;
  if (config.webModel !== undefined) ordered.webModel = config.webModel;
  if (config.compactModel !== undefined)
    ordered.compactModel = config.compactModel;
  if (config.imageModel !== undefined) ordered.imageModel = config.imageModel;

  // Limits
  ordered.tokenMax = config.tokenMax;
  if (config.spendLimitDollars !== undefined)
    ordered.spendLimitDollars = config.spendLimitDollars;
  if (config.spendLimitHours !== undefined)
    ordered.spendLimitHours = config.spendLimitHours;

  // Features
  if (config.mailEnabled !== undefined)
    ordered.mailEnabled = config.mailEnabled;
  if (config.webEnabled !== undefined) ordered.webEnabled = config.webEnabled;
  if (config.completeSessionEnabled !== undefined)
    ordered.completeSessionEnabled = config.completeSessionEnabled;
  if (config.wakeOnMessage !== undefined)
    ordered.wakeOnMessage = config.wakeOnMessage;
  if (config.workspacesEnabled !== undefined)
    ordered.workspacesEnabled = config.workspacesEnabled;
  if (config.disableMultipleCommands !== undefined)
    ordered.disableMultipleCommands = config.disableMultipleCommands;

  // Advanced
  if (config.commandProtection !== undefined)
    ordered.commandProtection = config.commandProtection;
  if (config.debugPauseSeconds !== undefined)
    ordered.debugPauseSeconds = config.debugPauseSeconds;
  if (config.initialCommands !== undefined)
    ordered.initialCommands = config.initialCommands;

  return ordered;
}

/**
 * Update agent configuration by user ID. Always updates DB.
 * Writes to file only if agent_path is non-null.
 */
export async function updateAgentConfigById(
  id: number,
  config: AgentConfigFile,
): Promise<void> {
  const user = await resolveUserById(id);
  const ordered = canonicalConfigOrder(config);
  const yamlStr = yaml.dump(ordered, { lineWidth: -1, noRefs: true });

  // Always update the config and denormalized fields in the database
  await usingNaisysDb(async (prisma) => {
    await prisma.users.update({
      where: { id: user.id },
      data: {
        config: yamlStr,
        title: config.title,
      },
    });
  });

  // Write to file only if agent_path is non-null
  if (user.agent_path) {
    try {
      await fs.writeFile(user.agent_path, yamlStr, "utf-8");
    } catch {
      // File may not exist or be inaccessible — DB is the source of truth
    }
  }

  // Update user notification modified date
  await updateUserNotificationModifiedDate(user.id);

  // Notify hub to broadcast updated user list to all NAISYS clients
  sendUserListChanged();
}
