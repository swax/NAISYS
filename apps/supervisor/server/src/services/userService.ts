import { assertUrlSafeKey } from "@naisys/common";
import { hashToken } from "@naisys/common-node";
import {
  getAgentApiKeyByUuid,
  rotateAgentApiKeyByUuid,
} from "@naisys/hub-database";
import type { Permission } from "@naisys/supervisor-database";
import { updateUserPassword } from "@naisys/supervisor-database";
import bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "crypto";

import supervisorDb from "../database/supervisorDb.js";

export type { User as SupervisorUserRow } from "@naisys/supervisor-database";
export { hashToken };

const SALT_ROUNDS = 10;

export async function getUserByUsername(username: string) {
  return supervisorDb.user.findUnique({ where: { username } });
}

export async function getUserByUsernameWithPermissions(username: string) {
  return supervisorDb.user.findUnique({
    where: { username },
    include: { permissions: true },
  });
}

export async function getUserByUuid(uuid: string) {
  return supervisorDb.user.findFirst({ where: { uuid } });
}

export async function createUserForAgent(username: string, uuid: string) {
  assertUrlSafeKey(username, "Username");
  return supervisorDb.user.create({
    data: {
      username,
      uuid,
      isAgent: true,
    },
    include: { permissions: true },
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
    supervisorDb.user.findMany({
      where,
      include: { permissions: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    supervisorDb.user.count({ where }),
  ]);

  return { items, total, pageSize };
}

export async function getUserById(id: number) {
  return supervisorDb.user.findUnique({
    where: { id },
    include: { permissions: true },
  });
}

export async function createUserWithPassword(data: {
  username: string;
  password: string;
}) {
  assertUrlSafeKey(data.username, "Username");
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
  const uuid = randomUUID();
  const user = await supervisorDb.user.create({
    data: {
      username: data.username,
      uuid,
      passwordHash,
      isAgent: false,
      apiKey: randomBytes(32).toString("hex"),
    },
    include: { permissions: true },
  });
  return user;
}

export async function updateUser(
  id: number,
  data: { username?: string; password?: string },
) {
  const updateData: Record<string, unknown> = {};
  if (data.username !== undefined) {
    assertUrlSafeKey(data.username, "Username");
    updateData.username = data.username;
  }

  const updated = await supervisorDb.user.update({
    where: { id },
    data: updateData,
    include: { permissions: true },
  });

  if (data.password !== undefined) {
    const newHash = await bcrypt.hash(data.password, SALT_ROUNDS);
    await updateUserPassword(updated.username, newHash);
  }

  return updated;
}

export async function deleteUser(id: number) {
  return supervisorDb.user.delete({ where: { id } });
}

export async function grantPermission(
  userId: number,
  permission: Permission,
  grantedBy: number,
) {
  return supervisorDb.userPermission.create({
    data: { userId, permission, grantedBy },
  });
}

export async function revokePermission(userId: number, permission: Permission) {
  return supervisorDb.userPermission.deleteMany({
    where: { userId, permission },
  });
}

export async function getUserPermissions(userId: number): Promise<string[]> {
  const perms = await supervisorDb.userPermission.findMany({
    where: { userId },
    select: { permission: true },
  });
  return perms.map((p) => p.permission);
}

export async function checkUserPermission(
  userId: number,
  permission: string,
): Promise<boolean> {
  const perm = await supervisorDb.userPermission.findFirst({
    where: { userId, permission: permission as Permission },
  });
  return perm !== null;
}

export async function getUserApiKey(id: number): Promise<string | null> {
  const user = await supervisorDb.user.findUnique({
    where: { id },
    select: { isAgent: true, uuid: true, apiKey: true },
  });
  if (!user) return null;

  if (user.isAgent) {
    return getAgentApiKeyByUuid(user.uuid);
  } else {
    return user.apiKey ?? null;
  }
}

export async function rotateUserApiKey(id: number): Promise<string> {
  const newKey = randomBytes(32).toString("hex");

  const user = await supervisorDb.user.findUnique({
    where: { id },
    select: { isAgent: true, uuid: true },
  });
  if (!user) throw new Error("User not found");

  if (user.isAgent) {
    await rotateAgentApiKeyByUuid(user.uuid, newKey);
  } else {
    await supervisorDb.user.update({
      where: { id },
      data: { apiKey: newKey },
    });
  }

  return newKey;
}
