import { SUPER_ADMIN_USERNAME } from "@naisys/common";
import { hashToken } from "@naisys/common-node";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import { existsSync } from "fs";
import readline from "readline/promises";

import { supervisorDbPath } from "./dbConfig.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prismaClient.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  userId: number;
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
export async function createSupervisorDatabaseClient(): Promise<boolean> {
  if (supervisorDb) return true;

  const dbPath = supervisorDbPath();

  if (!existsSync(dbPath)) return false;

  supervisorDb = await createPrismaClient(dbPath);
  return true;
}

/**
 * Find a session user by session token hash. Returns null if not found or expired.
 */
export async function findSession(
  tokenHash: string,
): Promise<SessionUser | null> {
  if (!supervisorDb) return null;

  const session = await supervisorDb.session.findUnique({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!session) return null;

  return {
    userId: session.user.id,
    username: session.user.username,
    passwordHash: session.user.passwordHash,
    uuid: session.user.uuid,
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
    userId: user.id,
    username: user.username,
    passwordHash: user.passwordHash,
    uuid: user.uuid,
  };
}

/**
 * Find a supervisor user by API key. Returns null if not found or DB not initialized.
 */
export async function findUserByApiKey(
  apiKey: string,
): Promise<{ uuid: string; username: string } | null> {
  if (!supervisorDb) return null;

  const user = await supervisorDb.user.findUnique({
    where: { apiKey },
    select: { uuid: true, username: true },
  });

  return user;
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

  const dbUser = await supervisorDb!.user.findUnique({
    where: { username },
  });

  await supervisorDb!.session.create({
    data: {
      userId: dbUser!.id,
      tokenHash,
      expiresAt,
    },
  });

  return { token, user, expiresAt };
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
 * Delete a session by token hash.
 */
export async function deleteSession(tokenHash: string): Promise<void> {
  if (!supervisorDb) return;

  await supervisorDb.session.deleteMany({
    where: { tokenHash },
  });
}

export interface EnsureSuperAdminResult {
  /** Whether the superadmin was newly created */
  created: boolean;
  /** The generated password (only set when created) */
  generatedPassword?: string;
  /** The superadmin user info */
  user: {
    uuid: string;
    username: string;
    passwordHash: string;
    apiKey: string | null;
  };
}

/**
 * Ensure a "superadmin" user exists in the supervisor database.
 * If already exists, returns it as-is. Otherwise creates with generated credentials.
 */
export async function ensureSuperAdmin(): Promise<EnsureSuperAdminResult> {
  if (!supervisorDb) throw new Error("Supervisor DB not initialized");

  const existing = await supervisorDb.user.findUnique({
    where: { username: SUPER_ADMIN_USERNAME },
  });

  if (existing) {
    return {
      created: false,
      user: {
        uuid: existing.uuid,
        username: existing.username,
        passwordHash: existing.passwordHash,
        apiKey: existing.apiKey,
      },
    };
  }

  const uuid = randomUUID();
  const password = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash(password, 10);
  const apiKey = randomBytes(32).toString("hex");

  const user = await supervisorDb.user.create({
    data: { uuid, username: SUPER_ADMIN_USERNAME, passwordHash, apiKey },
  });

  await supervisorDb.userPermission.create({
    data: { userId: user.id, permission: "supervisor_admin" },
  });

  return {
    created: true,
    generatedPassword: password,
    user: { uuid, username: SUPER_ADMIN_USERNAME, passwordHash, apiKey },
  };
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
  await createSupervisorDatabaseClient();

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
