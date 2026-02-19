import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { hashToken } from "@naisys/common/dist/hashToken.js";
import { createHubUser, updateHubUserPassword } from "@naisys/hub-database";
import prisma from "../db.js";
import type { Permission } from "@naisys/supervisor-database";

export type { User as SupervisorUserRow } from "@naisys/supervisor-database";
export { hashToken };

const SALT_ROUNDS = 10;

export async function getUserByUsername(username: string) {
  return prisma.user.findUnique({ where: { username } });
}

export async function getUserByUuid(uuid: string) {
  return prisma.user.findFirst({ where: { uuid } });
}

export async function createUser(username: string, uuid: string) {
  return prisma.user.create({
    data: { username, uuid },
  });
}

// --- User CRUD ---

export async function listUsers(options: {
  page: number;
  pageSize: number;
  search?: string;
}) {
  const { page, pageSize, search } = options;
  const where = search ? { username: { contains: search } } : {};

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { permissions: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { items, total, pageSize };
}

export async function getUserById(id: number) {
  return prisma.user.findUnique({
    where: { id },
    include: { permissions: true },
  });
}

export async function createUserWithPassword(data: {
  username: string;
  password: string;
  authType?: string;
}) {
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
  const uuid = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: data.username,
      uuid,
      authType: (data.authType as "password" | "api_key") || "password",
    },
    include: { permissions: true },
  });
  await createHubUser(data.username, passwordHash, uuid);
  return user;
}

export async function updateUser(
  id: number,
  data: { username?: string; password?: string },
) {
  const updateData: Record<string, unknown> = {};
  if (data.username !== undefined) updateData.username = data.username;

  const updated = await prisma.user.update({
    where: { id },
    data: updateData,
    include: { permissions: true },
  });

  if (data.password !== undefined) {
    const newHash = await bcrypt.hash(data.password, SALT_ROUNDS);
    await updateHubUserPassword(updated.username, newHash, updated.uuid);
  }

  return updated;
}

export async function deleteUser(id: number) {
  return prisma.user.delete({ where: { id } });
}

export async function grantPermission(
  userId: number,
  permission: Permission,
  grantedBy: number,
) {
  return prisma.userPermission.create({
    data: { userId, permission, grantedBy },
  });
}

export async function revokePermission(userId: number, permission: Permission) {
  return prisma.userPermission.deleteMany({
    where: { userId, permission },
  });
}

export async function getUserPermissions(userId: number): Promise<string[]> {
  const perms = await prisma.userPermission.findMany({
    where: { userId },
    select: { permission: true },
  });
  return perms.map((p) => p.permission);
}

export async function checkUserPermission(
  userId: number,
  permission: string,
): Promise<boolean> {
  const perm = await prisma.userPermission.findFirst({
    where: { userId, permission: permission as Permission },
  });
  return perm !== null;
}

export async function grantInitialAdminPermissions(userId: number) {
  const permissions: Permission[] = ["supervisor_admin", "manage_agents"];
  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: { userId_permission: { userId, permission } },
      create: { userId, permission },
      update: {},
    });
  }
}
