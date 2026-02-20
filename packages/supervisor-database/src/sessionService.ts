import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import readline from "readline/promises";
import { hashToken } from "@naisys/common-node";
import { supervisorDbPath } from "./dbConfig.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prismaClient.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  username: string;
  passwordHash: string;
  uuid: string;
}

let supervisorDb: PrismaClient | null = null;

/**
 * Initialize supervisor sessions by connecting to supervisor.db.
 * Idempotent — returns early if already initialized.
 * No-ops gracefully if NAISYS_FOLDER is unset or the database doesn't exist.
 */
export function createSupervisorDatabaseClient(): boolean {
  if (supervisorDb) return true;

  const dbPath = supervisorDbPath();

  if (!existsSync(dbPath)) return false;

  supervisorDb = createPrismaClient(dbPath);
  return true;
}

/**
 * Find a session user by session token hash. Returns null if not found or expired.
 */
export async function findSession(
  tokenHash: string,
): Promise<SessionUser | null> {
  if (!supervisorDb) return null;

  const user = await supervisorDb.user.findFirst({
    where: {
      sessionTokenHash: tokenHash,
      sessionExpiresAt: { gt: new Date() },
    },
  });

  if (!user) return null;

  return {
    username: user.username,
    passwordHash: user.passwordHash,
    uuid: user.uuid,
  };
}

/**
 * Look up a session user by username.
 */
export async function lookupUsername(
  username: string,
): Promise<SessionUser | null> {
  if (!supervisorDb) return null;

  const user = await supervisorDb.user.findUnique({
    where: { username },
  });

  if (!user) return null;

  return {
    username: user.username,
    passwordHash: user.passwordHash,
    uuid: user.uuid,
  };
}

export interface AuthResult {
  token: string;
  user: SessionUser;
  expiresAt: Date;
}

/**
 * Authenticate a user by username/password and create a session.
 * Returns null if credentials are invalid or DB is not initialized.
 */
export async function authenticateAndCreateSession(
  username: string,
  password: string,
): Promise<AuthResult | null> {
  const user = await lookupUsername(username);
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  const token = randomUUID();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await createSession(
    tokenHash,
    user.username,
    user.passwordHash,
    user.uuid,
    expiresAt,
  );

  return { token, user, expiresAt };
}

/**
 * Create or update a session for a user by uuid.
 */
export async function createSession(
  tokenHash: string,
  username: string,
  passwordHash: string,
  uuid: string,
  expiresAt: Date,
): Promise<void> {
  if (!supervisorDb) return;

  await supervisorDb.user.update({
    where: { username },
    data: {
      passwordHash,
      sessionTokenHash: tokenHash,
      sessionExpiresAt: expiresAt,
    },
  });
}

/**
 * Update a user's password hash. No-op if not initialized.
 */
export async function updateUserPassword(
  username: string,
  passwordHash: string,
): Promise<void> {
  if (!supervisorDb) return;

  await supervisorDb.user.update({
    where: { username },
    data: { passwordHash },
  });
}

/**
 * Clear session token for a user by token hash.
 */
export async function deleteSession(tokenHash: string): Promise<void> {
  if (!supervisorDb) return;

  await supervisorDb.user.updateMany({
    where: { sessionTokenHash: tokenHash },
    data: {
      sessionTokenHash: null,
      sessionExpiresAt: null,
    },
  });
}

/**
 * Ensure a "superadmin" user exists in the supervisor database.
 * If the entry already exists with a password, this is a no-op.
 * Otherwise generates credentials and delegates local user creation to the callback.
 */
export async function ensureSuperAdmin(
  ensureLocalSuperAdmin: (
    passwordHash: string,
    uuid: string,
    superAdminName: string,
  ) => Promise<boolean>,
): Promise<void> {
  const superAdminName = "superadmin";
  const existing = await lookupUsername(superAdminName);
  if (existing && existing.passwordHash !== "") return;

  const uuid = existing?.uuid || randomUUID();
  const password = randomUUID().slice(0, 8);
  const hash = await bcrypt.hash(password, 10);

  const created = await ensureLocalSuperAdmin(hash, uuid, superAdminName);

  if (created) {
    await updateUserPassword(superAdminName, hash);
    console.log(`\n  ${superAdminName} user created. Password: ${password}`);
    console.log(`  Change it via the web UI or ns-admin-pw command\n`);
  }
}

/**
 * CLI entry point for --reset-password. Initializes supervisor sessions,
 * then runs the interactive password reset.
 */
export async function handleResetPassword(options: {
  findLocalUser: (
    username: string,
  ) => Promise<{ id: number; username: string; uuid: string } | null>;
  updateLocalPassword: (userId: number, passwordHash: string) => Promise<void>;
  username?: string;
  password?: string;
}): Promise<void> {
  console.log(`NAISYS_FOLDER: ${process.env.NAISYS_FOLDER}`);
  createSupervisorDatabaseClient();

  await resetPassword(
    options.findLocalUser,
    options.updateLocalPassword,
    options.username,
    options.password,
  );
}

/**
 * CLI to reset a user's password. Updates both local DB (via callbacks) and
 * the supervisor DB. If username/password are provided, skips interactive
 * prompts.
 */
export async function resetPassword(
  findLocalUser: (
    username: string,
  ) => Promise<{ id: number; username: string; uuid: string } | null>,
  updateLocalPassword: (userId: number, passwordHash: string) => Promise<void>,
  usernameArg?: string,
  passwordArg?: string,
): Promise<void> {
  let username: string;
  let password: string;

  if (usernameArg && passwordArg) {
    username = usernameArg;
    password = passwordArg;
  } else {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      username = usernameArg || (await rl.question("Username: "));
      password = passwordArg || (await rl.question("New password: "));
    } finally {
      rl.close();
    }
  }

  const user = await findLocalUser(username);
  if (!user) {
    console.error(`User '${username}' not found.`);
    process.exit(1);
  }

  if (password.length < 6) {
    console.error("Password must be at least 6 characters.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  await updateLocalPassword(user.id, hash);
  await updateUserPassword(username, hash);

  console.log(`Password reset for '${username}'.`);
}
