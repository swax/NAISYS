import {
  AgentConfigFile,
  AgentConfigFileSchema,
  buildDefaultAgentConfig,
} from "@naisys/common";
import { randomBytes } from "crypto";
import { hubDb } from "../database/hubDb.js";
import { sendUserListChanged } from "./hubConnectionService.js";

/**
 * Update the modified date on the user_notifications table
 */
async function updateUserNotificationModifiedDate(
  userId: number,
): Promise<void> {
  await hubDb.user_notifications.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      updated_at: new Date(),
    },
    update: {
      updated_at: new Date(),
    },
  });
}

/**
 * Create a new agent with database entry.
 */
export async function createAgentConfig(
  name: string,
): Promise<{ id: number; config: AgentConfigFile }> {
  // Check db if username already exists
  const existingAgent = await hubDb.users.findFirst({
    where: {
      username: name,
    },
  });

  if (existingAgent) {
    throw new Error(`Agent '${name}' already exists in the database`);
  }

  // Create default config and convert to JSON
  const defaultConfig = buildDefaultAgentConfig(name);
  const jsonContent = JSON.stringify(canonicalConfigOrder(defaultConfig));

  // Add agent to the database, let DB autoincrement
  const user = await hubDb.users.create({
    data: {
      uuid: crypto.randomUUID(),
      username: defaultConfig.username,
      title: defaultConfig.title,
      config: jsonContent,
      api_key: randomBytes(32).toString("hex"),
    },
  });

  // Update user notification modified date
  await updateUserNotificationModifiedDate(user.id);

  // Notify hub to broadcast updated user list to all NAISYS clients
  sendUserListChanged();

  return { id: user.id, config: defaultConfig };
}

/**
 * Get parsed agent configuration by user ID. Reads from DB config column.
 */
export async function getAgentConfigById(id: number): Promise<AgentConfigFile> {
  const user = await hubDb.users.findUnique({
    where: { id },
    select: { config: true },
  });

  if (!user) {
    throw new Error(`User with ID ${id} not found`);
  }

  const parsed = JSON.parse(user.config);
  return AgentConfigFileSchema.parse(parsed);
}

/**
 * Build config object in canonical field order for consistent JSON output.
 */
function canonicalConfigOrder(
  config: AgentConfigFile,
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};

  // Identity
  ordered.username = config.username;
  ordered.title = config.title;

  // Prompt
  ordered.agentPrompt = config.agentPrompt;

  // Models
  ordered.shellModel = config.shellModel;
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
  if (config.chatEnabled !== undefined)
    ordered.chatEnabled = config.chatEnabled;
  if (config.webEnabled !== undefined) ordered.webEnabled = config.webEnabled;
  if (config.completeSessionEnabled !== undefined)
    ordered.completeSessionEnabled = config.completeSessionEnabled;
  if (config.wakeOnMessage !== undefined)
    ordered.wakeOnMessage = config.wakeOnMessage;
  if (config.workspacesEnabled !== undefined)
    ordered.workspacesEnabled = config.workspacesEnabled;
  if (config.multipleCommandsEnabled !== undefined)
    ordered.multipleCommandsEnabled = config.multipleCommandsEnabled;

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
  const ordered = canonicalConfigOrder(config);
  const jsonStr = JSON.stringify(ordered);

  await hubDb.users.update({
    where: { id },
    data: {
      config: jsonStr,
      title: config.title,
    },
  });

  // Update user notification modified date
  await updateUserNotificationModifiedDate(id);

  // Notify hub to broadcast updated user list to all NAISYS clients
  sendUserListChanged();
}
