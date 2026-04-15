import { existsSync } from "fs";

import { hubDbPath } from "./dbConfig.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prismaClient.js";

let prisma: PrismaClient | null = null;

/**
 * Initialize hub sessions by connecting to the shared naisys_hub.db.
 * Idempotent — returns early if already initialized.
 * No-ops gracefully if NAISYS_FOLDER is unset or the database doesn't exist.
 */
export async function createHubDatabaseClient(): Promise<boolean> {
  if (prisma) return true;

  const dbPath = hubDbPath();

  if (!existsSync(dbPath)) return false;

  prisma = await createPrismaClient(dbPath);
  return true;
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
 * Find a hub agent by its numeric ID.
 */
export async function getHubAgentById(
  id: number,
): Promise<{ id: number; uuid: string; username: string } | null> {
  if (!prisma) return null;

  return prisma.users.findUnique({
    where: { id },
    select: { id: true, uuid: true, username: true },
  });
}

/**
 * Look up an agent's API key by UUID.
 */
export async function getAgentApiKeyByUuid(
  uuid: string,
): Promise<string | null> {
  if (!prisma) return null;

  const user = await prisma.users.findFirst({
    where: { uuid },
    select: { api_key: true },
  });

  return user?.api_key ?? null;
}

/**
 * Get the latest run_id and current session start time for a hub user by UUID.
 */
export async function getLatestRunInfoByUuid(
  uuid: string,
): Promise<{ runId: number; sessionStart: Date } | null> {
  if (!prisma) return null;

  const user = await prisma.users.findFirst({
    where: { uuid },
    select: { id: true },
  });
  if (!user) return null;

  const latest = await prisma.run_session.findFirst({
    where: { user_id: user.id },
    orderBy: [{ run_id: "desc" }, { session_id: "desc" }],
    select: { run_id: true, created_at: true },
  });
  if (!latest) return null;

  return { runId: latest.run_id, sessionStart: latest.created_at };
}

/**
 * Sum the cost of all cost entries for a hub user (by UUID) within a time range.
 */
export async function sumCostsByUuid(
  uuid: string,
  from: Date,
  to: Date,
): Promise<number> {
  if (!prisma) return 0;

  const user = await prisma.users.findFirst({
    where: { uuid },
    select: { id: true },
  });
  if (!user) return 0;

  const result = await prisma.costs.aggregate({
    _sum: { cost: true },
    where: {
      user_id: user.id,
      created_at: { gte: from, lte: to },
    },
  });

  return result._sum.cost ?? 0;
}

/**
 * Rotate an agent's API key by UUID.
 */
export async function rotateAgentApiKeyByUuid(
  uuid: string,
  newKey: string,
): Promise<void> {
  if (!prisma) throw new Error("Hub database not initialized");

  const user = await prisma.users.findFirst({
    where: { uuid },
    select: { id: true },
  });
  if (!user) throw new Error("Agent not found in hub database");

  await prisma.users.update({
    where: { id: user.id },
    data: { api_key: newKey },
  });
}

/**
 * Read a variable value from the hub database.
 */
export async function getHubVariable(key: string): Promise<string | null> {
  if (!prisma) return null;
  const row = await prisma.variables.findUnique({ where: { key } });
  return row?.value ?? null;
}
