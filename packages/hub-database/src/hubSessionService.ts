import { hashToken } from "@naisys/common-node";
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
 * Find an agent (from the hub `users` table) by runtime API key.
 */
export async function findAgentByApiKey(
  apiKey: string,
): Promise<{ uuid: string; username: string } | null> {
  if (!prisma) return null;

  const user = await prisma.users.findUnique({
    where: { api_key_hash: hashToken(apiKey) },
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
    where: { user_id: user.id, subagent_id: 0 },
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
 * Aggregate cost (dollars) and token throughput for a hub user within a time
 * range. This is used for labor allocation: when one agent session works
 * multiple operations, a final context-size snapshot cannot be split across
 * operations, so tokens follow the same clock-window model as cost. Labor
 * tickets report input + output because those are the expensive tokens ops
 * should minimize; cached token buckets are much cheaper and stay as cache
 * accounting detail rather than part of the labor token total.
 */
export async function sumAgentMetricsByUuid(
  uuid: string,
  from: Date,
  to: Date,
): Promise<{ cost: number; tokens: number }> {
  if (!prisma) return { cost: 0, tokens: 0 };

  const user = await prisma.users.findFirst({
    where: { uuid },
    select: { id: true },
  });
  if (!user) return { cost: 0, tokens: 0 };

  const result = await prisma.costs.aggregate({
    _sum: {
      cost: true,
      input_tokens: true,
      output_tokens: true,
    },
    where: {
      user_id: user.id,
      created_at: { gte: from, lte: to },
    },
  });

  return {
    cost: result._sum.cost ?? 0,
    tokens: (result._sum.input_tokens ?? 0) + (result._sum.output_tokens ?? 0),
  };
}

/**
 * Read a variable value from the hub database.
 */
export async function getHubVariable(key: string): Promise<string | null> {
  if (!prisma) return null;
  const row = await prisma.variables.findUnique({ where: { key } });
  return row?.value ?? null;
}
