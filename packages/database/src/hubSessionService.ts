import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import readline from "readline/promises";
import { hubDbPath } from "./dbConfig.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prismaClient.js";

export interface HubUser {
  username: string;
  password_hash: string;
  uuid: string;
}

let prisma: PrismaClient | null = null;

export function isHubAvailable(): boolean {
  return prisma !== null;
}

/**
 * Initialize hub sessions by connecting to the shared naisys_hub.db.
 * Idempotent — returns early if already initialized.
 * No-ops gracefully if NAISYS_FOLDER is unset or the database doesn't exist.
 */
export function initHubSessions(): boolean {
  if (prisma) return true;

  const dbPath = hubDbPath();

  if (!existsSync(dbPath)) return false;

  prisma = createPrismaClient(dbPath);
  return true;
}

/**
 * Find a hub user by session token hash. Returns null if not found or expired.
 */
export async function findHubSession(
  tokenHash: string,
): Promise<HubUser | null> {
  if (!prisma) return null;

  const user = await prisma.supervisor_users.findFirst({
    where: {
      session_token_hash: tokenHash,
      session_expires_at: { gt: new Date() },
    },
  });

  if (!user) return null;

  return {
    username: user.username,
    password_hash: user.password_hash,
    uuid: user.uuid,
  };
}

/**
 * Look up a hub user by username.
 */
export async function findHubUserByUsername(
  username: string,
): Promise<HubUser | null> {
  if (!prisma) return null;

  const user = await prisma.supervisor_users.findUnique({
    where: { username },
  });

  if (!user) return null;

  return {
    username: user.username,
    password_hash: user.password_hash,
    uuid: user.uuid,
  };
}

/**
 * Create or update a hub user and set their session token.
 */
export async function createHubSession(
  tokenHash: string,
  username: string,
  passwordHash: string,
  uuid: string,
  expiresAt: Date,
): Promise<void> {
  if (!prisma) return;

  await prisma.supervisor_users.upsert({
    where: { uuid },
    create: {
      uuid,
      username,
      password_hash: passwordHash,
      session_token_hash: tokenHash,
      session_expires_at: expiresAt,
    },
    update: {
      username,
      password_hash: passwordHash,
      session_token_hash: tokenHash,
      session_expires_at: expiresAt,
    },
  });
}

/**
 * Count the number of hub users. Returns 0 if hub is unavailable.
 */
export async function countHubUsers(): Promise<number> {
  if (!prisma) return 0;
  return prisma.supervisor_users.count();
}

/**
 * Create a hub user record (without session fields). No-op if hub unavailable.
 */
export async function createHubUser(
  username: string,
  passwordHash: string,
  uuid: string,
): Promise<void> {
  if (!prisma) return;

  await prisma.supervisor_users.upsert({
    where: { uuid },
    create: {
      uuid,
      username,
      password_hash: passwordHash,
    },
    update: {
      username,
      password_hash: passwordHash,
    },
  });
}

/**
 * Update (or create) a hub user's password hash by username.
 * Uses the provided uuid so the hub record matches the local user's identity.
 * No-op if hub unavailable.
 */
export async function updateHubUserPassword(
  username: string,
  passwordHash: string,
  uuid: string,
): Promise<void> {
  if (!prisma) return;

  const existing = await prisma.supervisor_users.findUnique({
    where: { username },
  });

  if (existing) {
    await prisma.supervisor_users.update({
      where: { username },
      data: { password_hash: passwordHash },
    });
  } else {
    await prisma.supervisor_users.create({
      data: {
        uuid,
        username,
        password_hash: passwordHash,
      },
    });
  }
}

/**
 * Find a hub agent (from the hub `users` table) by username.
 */
export async function findHubAgentByUsername(
  username: string,
): Promise<{ uuid: string } | null> {
  if (!prisma) return null;

  const agent = await prisma.users.findFirst({
    where: { username },
    select: { uuid: true },
  });

  return agent;
}

/**
 * Ensure an admin user exists locally. Looks up the "admin" agent in the hub
 * `users` table to get its UUID, then delegates to the callback which should
 * create the admin if it doesn't already exist (upsert by UUID).
 *
 * Returns true if a new admin was created (password was generated).
 */
export async function ensureAdminUser(
  ensureLocalAdmin: (
    passwordHash: string,
    uuid: string,
  ) => Promise<boolean>,
): Promise<void> {
  const hubAgent = await findHubAgentByUsername("admin");
  if (!hubAgent) {
    console.error(
      "[ensureAdminUser] No 'admin' agent found in hub. Was the agent config seeded?",
    );
    process.exit(1);
  }

  const password = randomUUID().slice(0, 8);
  const hash = await bcrypt.hash(password, 10);

  const created = await ensureLocalAdmin(hash, hubAgent.uuid);

  if (created) {
    await createHubUser("admin", hash, hubAgent.uuid);
    console.log(`\n  Admin user created. Password: ${password}`);
    console.log(`  Change it via the web UI or ns-admin-pw command\n`);
  }
}

/**
 * Find an agent (from the hub `users` table) by API key.
 */
export async function findAgentByApiKey(
  apiKey: string,
): Promise<{ uuid: string; username: string } | null> {
  if (!prisma) return null;

  const user = await prisma.users.findUnique({
    where: { api_key: apiKey },
    select: { uuid: true, username: true },
  });

  return user;
}

/**
 * Clear session token for a hub user by token hash.
 */
export async function deleteHubSession(tokenHash: string): Promise<void> {
  if (!prisma) return;

  await prisma.supervisor_users.updateMany({
    where: { session_token_hash: tokenHash },
    data: {
      session_token_hash: null,
      session_expires_at: null,
    },
  });
}

/**
 * CLI entry point for --reset-password. Initializes hub sessions,
 * then runs the interactive password reset.
 */
export async function handleResetPassword(options: {
  findLocalUser: (
    username: string,
  ) => Promise<{ id: number; username: string; uuid: string } | null>;
  updateLocalPassword: (userId: number, passwordHash: string) => Promise<void>;
  requireHub?: boolean;
}): Promise<void> {
  console.log(`NAISYS_FOLDER: ${process.env.NAISYS_FOLDER}`);
  const hubAvailable = initHubSessions();

  if (options.requireHub && !hubAvailable) {
    console.error("Hub database not found. Cannot reset password without it.");
    process.exit(1);
  }

  await resetPassword(options.findLocalUser, options.updateLocalPassword);
}

/**
 * Interactive CLI to reset a user's password. Updates both local DB (via
 * callbacks) and the hub DB.
 */
export async function resetPassword(
  findLocalUser: (
    username: string,
  ) => Promise<{ id: number; username: string; uuid: string } | null>,
  updateLocalPassword: (userId: number, passwordHash: string) => Promise<void>,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const username = await rl.question("Username: ");
    const user = await findLocalUser(username);
    if (!user) {
      console.error(`User '${username}' not found.`);
      process.exit(1);
    }

    const password = await rl.question("New password: ");
    if (password.length < 6) {
      console.error("Password must be at least 6 characters.");
      process.exit(1);
    }

    const hash = await bcrypt.hash(password, 10);
    await updateLocalPassword(user.id, hash);
    await updateHubUserPassword(username, hash, user.uuid);

    console.log(`Password reset for '${username}'.`);
  } finally {
    rl.close();
  }
}
