import { createHash } from "crypto";
import prisma from "../db.js";

export type { User as SupervisorUserRow } from "../generated/prisma/client.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export async function getUserByUuid(uuid: string) {
  return prisma.user.findFirst({ where: { uuid } });
}

export async function getUserByTokenHash(tokenHash: string) {
  return prisma.user.findFirst({
    where: {
      sessionTokenHash: tokenHash,
      sessionExpiresAt: { gt: new Date() },
    },
  });
}

export async function createUser(
  username: string,
  passwordHash: string,
  uuid: string,
) {
  return prisma.user.create({
    data: { username, passwordHash, uuid },
  });
}

export async function setSessionOnUser(
  userId: number,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      sessionTokenHash: tokenHash,
      sessionExpiresAt: expiresAt,
    },
  });
}

export async function clearSessionOnUser(userId: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      sessionTokenHash: null,
      sessionExpiresAt: null,
    },
  });
}
