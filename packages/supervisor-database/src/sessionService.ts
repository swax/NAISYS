import { SUPER_ADMIN_USERNAME } from "@naisys/common";
import { hashToken } from "@naisys/common-node";
import { randomBytes, randomUUID } from "crypto";
import { existsSync } from "fs";

import { supervisorDbPath } from "./dbConfig.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prismaClient.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  userId: number;
  username: string;
  uuid: string;
}

let supervisorDb: PrismaClient | null = null;

export function getSupervisorDb(): PrismaClient {
  if (!supervisorDb) throw new Error("Supervisor DB not initialized");
  return supervisorDb;
}

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
    uuid: session.user.uuid,
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
 * Create a session for a user. Returns the session token (plaintext) and expiry.
 * Caller is responsible for setting it as a cookie.
 */
export async function createSessionForUser(
  userId: number,
): Promise<AuthResult> {
  if (!supervisorDb) throw new Error("Supervisor DB not initialized");

  const dbUser = await supervisorDb.user.findUnique({ where: { id: userId } });
  if (!dbUser) throw new Error(`User ${userId} not found`);

  const token = randomUUID();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await supervisorDb.session.create({
    data: { userId, tokenHash, expiresAt },
  });

  return {
    token,
    expiresAt,
    user: {
      userId: dbUser.id,
      username: dbUser.username,
      uuid: dbUser.uuid,
    },
  };
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

/**
 * Revoke every active session for a user. Used after admin recovery actions
 * (passkey reset, credential deletion) so a compromised browser cookie can't
 * outlive the credential it was minted from.
 *
 * Pass `exceptTokenHash` when the action is initiated by the user themselves
 * — keeps the actor's own browser logged in while booting any other devices,
 * which is the common "I'm pruning credentials, log my other tabs out" UX.
 */
export async function deleteAllSessionsForUser(
  userId: number,
  exceptTokenHash?: string,
): Promise<void> {
  if (!supervisorDb) return;

  await supervisorDb.session.deleteMany({
    where: exceptTokenHash
      ? { userId, NOT: { tokenHash: exceptTokenHash } }
      : { userId },
  });
}

export interface EnsureSuperAdminResult {
  user: {
    id: number;
    uuid: string;
    username: string;
    apiKey: string | null;
  };
  /** True when the superadmin user record was just created (i.e. first-time bootstrap) */
  created: boolean;
}

/**
 * Ensure a "superadmin" user exists in the supervisor database.
 * Creates the user record without any credentials — the caller is expected to
 * issue a registration token so the operator can register a passkey.
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
        id: existing.id,
        uuid: existing.uuid,
        username: existing.username,
        apiKey: existing.apiKey,
      },
    };
  }

  const uuid = randomUUID();
  const apiKey = randomBytes(32).toString("hex");

  const user = await supervisorDb.user.create({
    data: { uuid, username: SUPER_ADMIN_USERNAME, apiKey },
  });

  await supervisorDb.userPermission.create({
    data: { userId: user.id, permission: "supervisor_admin" },
  });

  return {
    created: true,
    user: { id: user.id, uuid, username: SUPER_ADMIN_USERNAME, apiKey },
  };
}
