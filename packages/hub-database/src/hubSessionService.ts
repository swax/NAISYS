import { existsSync } from "fs";
import { hubDbPath } from "./dbConfig.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prismaClient.js";

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
