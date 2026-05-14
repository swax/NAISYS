import type { AgentConfigFile } from "@naisys/common";
import {
  AgentConfigFileSchema,
  assertUrlSafeKey,
  buildDefaultAgentConfig,
  parseContinuityFromConfigJson,
} from "@naisys/common";

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
  title?: string,
): Promise<{ id: number; config: AgentConfigFile }> {
  assertUrlSafeKey(name, "Agent name");

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
  if (title) {
    defaultConfig.title = title;
  }
  const jsonContent = JSON.stringify(canonicalConfigOrder(defaultConfig));

  // Add agent to the database, let DB autoincrement
  const user = await hubDb.users.create({
    data: {
      uuid: crypto.randomUUID(),
      username: defaultConfig.username,
      title: defaultConfig.title,
      config: jsonContent,
      enabled: true,
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
 * Get the list of hosts assigned to an agent.
 */
export async function getAgentAssignedHosts(
  id: number,
): Promise<{ id: number; name: string }[]> {
  const rows = await hubDb.user_hosts.findMany({
    where: { user_id: id },
    select: { host: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.host.id, name: r.host.name }));
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
  if (config.browserEnabled !== undefined)
    ordered.browserEnabled = config.browserEnabled;
  if (config.completeSessionEnabled !== undefined)
    ordered.completeSessionEnabled = config.completeSessionEnabled;
  if (config.wakeOnMessage !== undefined)
    ordered.wakeOnMessage = config.wakeOnMessage;
  if (config.workspacesEnabled !== undefined)
    ordered.workspacesEnabled = config.workspacesEnabled;
  if (config.multipleCommandsEnabled !== undefined)
    ordered.multipleCommandsEnabled = config.multipleCommandsEnabled;
  if (config.controlDesktop !== undefined)
    ordered.controlDesktop = config.controlDesktop;
  if (config.supervisorApiHints !== undefined)
    ordered.supervisorApiHints = config.supervisorApiHints;

  // Advanced
  if (config.autoCompact !== undefined) ordered.autoCompact = config.autoCompact;
  if (config.continuity !== undefined) ordered.continuity = config.continuity;
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
 * Snapshots the previous config as a revision before overwriting.
 */
export async function updateAgentConfigById(
  id: number,
  config: AgentConfigFile,
  setUsername: boolean,
  changedById?: number,
): Promise<AgentConfigFile> {
  // Snapshot the current config before overwriting
  const currentUser = await hubDb.users.findUnique({
    where: { id },
    select: { config: true, username: true },
  });

  if (setUsername) {
    // Normal edit: push config.username to the DB column
  } else if (currentUser) {
    // Import: preserve the DB username, override it in the config
    config = { ...config, username: currentUser.username };
  }

  const ordered = canonicalConfigOrder(config);
  const jsonStr = JSON.stringify(ordered);

  // Save revision of the old config (if it exists and differs)
  if (currentUser?.config && currentUser.config !== jsonStr) {
    await hubDb.config_revisions.create({
      data: {
        user_id: id,
        config: currentUser.config,
        changed_by_id: changedById ?? id,
      },
    });
  }

  // Wall off prior history when continuity leaves "fresh" so the first run
  // under summary/full doesn't replay every prior log entry and retro-compact
  // unrelated past sessions. Done before the config update so a concurrent
  // AGENT_START never observes continuity=summary with a null cursor — the
  // other ordering would trigger exactly the full-history bundle we're
  // avoiding.
  const oldContinuity = parseContinuityFromConfigJson(currentUser?.config);
  if (
    (oldContinuity === undefined || oldContinuity === "fresh") &&
    (config.continuity === "summary" || config.continuity === "full")
  ) {
    await writeContinuityBoundary(id);
  }

  // mail_messages.participants is a denormalized sorted CSV of usernames used
  // as the conversation lookup key. On rename, rewrite every row that names
  // the old user so old threads stay reachable and don't fork on the next reply.
  const oldUsername = currentUser?.username;
  const newUsername = config.username;
  const renaming =
    setUsername && !!oldUsername && oldUsername !== newUsername;

  await hubDb.$transaction(async (hubTx) => {
    if (renaming) {
      const rows = await hubTx.mail_messages.findMany({
        where: { participants: { contains: oldUsername } },
        select: { id: true, participants: true },
      });
      for (const row of rows) {
        const names = row.participants.split(",");
        // `contains` can substring-match (e.g. "alice" inside "alicia")
        if (!names.includes(oldUsername)) continue;
        const next = names
          .map((n) => (n === oldUsername ? newUsername : n))
          .sort()
          .join(",");
        if (next !== row.participants) {
          await hubTx.mail_messages.update({
            where: { id: row.id },
            data: { participants: next },
          });
        }
      }
    }

    await hubTx.users.update({
      where: { id },
      data: {
        config: jsonStr,
        ...(setUsername && { username: newUsername }),
        title: config.title,
      },
    });
  });

  // Update user notification modified date
  await updateUserNotificationModifiedDate(id);

  // Notify hub to broadcast updated user list to all NAISYS clients
  sendUserListChanged();

  return config;
}

/**
 * Get config revision history for an agent.
 */
export async function getConfigRevisions(
  userId: number,
  limit = 50,
): Promise<
  { id: number; config: string; changedByUsername: string; createdAt: Date }[]
> {
  const revisions = await hubDb.config_revisions.findMany({
    where: { user_id: userId },
    orderBy: { created_at: "desc" },
    take: limit,
    include: {
      changed_by: { select: { username: true } },
    },
  });

  return revisions.map((r) => ({
    id: r.id,
    config: r.config,
    changedByUsername: r.changed_by.username,
    createdAt: r.created_at,
  }));
}

/** Same end state `ns-session clear` produces, just triggered by a config
 *  change instead of an agent command: write a marker compact row anchored
 *  to the user's latest session and point `compact_log_id` at it. The next
 *  AGENT_START reads an empty tail past the cursor, so summary/full both
 *  ship `{ summary, cursor }` without replay or LLM retro-compact. Skipped
 *  for brand-new users with no prior entries (no boundary to draw). */
async function writeContinuityBoundary(userId: number): Promise<void> {
  const [user, latest] = await Promise.all([
    hubDb.users.findUnique({
      where: { id: userId },
      select: { compact_log_id: true },
    }),
    hubDb.context_log.findFirst({
      where: { user_id: userId, subagent_id: 0 },
      orderBy: { id: "desc" },
      select: { id: true, run_id: true, session_id: true, host_id: true },
    }),
  ]);
  if (!latest) return;

  // Cursor already at the head — happens on ping-pong (fresh → summary →
  // fresh → summary with no activity in between, so the previous marker is
  // still the latest row) or right after `ns-session compact`/`clear`
  // landed a compact row that the hub mirror already advanced the cursor
  // to. Either way, there's no tail to seal — skip the duplicate marker.
  if (user?.compact_log_id === latest.id) return;

  const marker = await hubDb.context_log.create({
    data: {
      user_id: userId,
      run_id: latest.run_id,
      subagent_id: 0,
      session_id: latest.session_id,
      host_id: latest.host_id,
      role: "LLM",
      source: "llm",
      type: "compact",
      message: "Continuity enabled — prior history not carried forward.",
    },
    select: { id: true },
  });

  await hubDb.users.update({
    where: { id: userId },
    data: { compact_log_id: marker.id },
  });
}
