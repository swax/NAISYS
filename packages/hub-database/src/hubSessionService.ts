import { existsSync } from "fs";

import { hubDbPath } from "./dbConfig.js";
import { PrismaClient } from "./generated/prisma/client.js";
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
