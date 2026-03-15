import {
  getAgentApiKeyByUuid,
  rotateAgentApiKeyByUuid,
} from "@naisys/hub-database";
import type { ErpPermission } from "@naisys-erp/shared";
import bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "crypto";

import erpDb from "../erpDb.js";
import { isSupervisorAuth } from "../supervisorAuth.js";

// --- Prisma include & result type ---

export const includePermissions = {
  permissions: true,
} as const;

export type UserWithPermissions = {
  id: number;
  username: string;
  isAgent: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: {
    permission: string;
    grantedAt: Date;
    grantedBy: number | null;
  }[];
};

// --- Constants ---

const SALT_ROUNDS = 10;

// --- Lookups ---

export async function listUsers(options: {
  page: number;
  pageSize: number;
  search?: string;
}) {
  const { page, pageSize, search } = options;
  const where = search ? { username: { contains: search } } : {};

  const [items, total] = await Promise.all([
    erpDb.user.findMany({
      where,
      include: includePermissions,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    erpDb.user.count({ where }),
  ]);

  return { items, total, pageSize };
}

export async function getUserByUsername(username: string) {
  return erpDb.user.findUnique({
    where: { username },
    include: includePermissions,
  });
}

export async function getUserById(id: number) {
  return erpDb.user.findUnique({
    where: { id },
    include: includePermissions,
  });
}

export async function getUserApiKey(id: number): Promise<string | null> {
  const user = await erpDb.user.findUnique({
    where: { id },
    select: { isAgent: true, uuid: true, apiKey: true },
  });
  if (!user) return null;

  if (user.isAgent && isSupervisorAuth()) {
    return getAgentApiKeyByUuid(user.uuid);
  } else {
    return user.apiKey ?? null;
  }
}

// --- Mutations ---

export async function getUserByUuid(uuid: string) {
  return erpDb.user.findFirst({
    where: { uuid },
    include: includePermissions,
  });
}

export async function createUserForAgent(username: string, uuid: string) {
  return erpDb.user.create({
    data: {
      username,
      uuid,
      passwordHash: "",
      isAgent: true,
    },
    include: includePermissions,
  });
}

export async function createUserWithPassword(data: {
  username: string;
  password: string;
}) {
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
  const uuid = randomUUID();
  return erpDb.user.create({
    data: {
      username: data.username,
      uuid,
      passwordHash,
      isAgent: false,
      apiKey: randomBytes(32).toString("hex"),
    },
    include: includePermissions,
  });
}

export async function updateUser(
  id: number,
  data: { username?: string; password?: string },
) {
  const updateData: Record<string, unknown> = {};
  if (data.username !== undefined) {
    updateData.username = data.username;
  }
  if (data.password !== undefined) {
    updateData.passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
  }

  return erpDb.user.update({
    where: { id },
    data: updateData,
    include: includePermissions,
  });
}

export async function deleteUser(id: number) {
  return erpDb.user.delete({ where: { id } });
}

export async function grantPermission(
  userId: number,
  permission: ErpPermission,
  grantedBy: number,
) {
  return erpDb.userPermission.create({
    data: { userId, permission, grantedBy },
  });
}

export async function revokePermission(
  userId: number,
  permission: ErpPermission,
) {
  return erpDb.userPermission.deleteMany({
    where: { userId, permission },
  });
}

export async function rotateUserApiKey(id: number): Promise<string> {
  const newKey = randomBytes(32).toString("hex");

  const user = await erpDb.user.findUnique({
    where: { id },
    select: { isAgent: true, uuid: true },
  });
  if (!user) throw new Error("User not found");

  if (user.isAgent && isSupervisorAuth()) {
    await rotateAgentApiKeyByUuid(user.uuid, newKey);
  } else {
    await erpDb.user.update({
      where: { id },
      data: { apiKey: newKey },
    });
  }

  return newKey;
}
