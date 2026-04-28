import { generatePersistentUserApiKey } from "@naisys/common-node";
import type { ErpPermission } from "@naisys/erp-shared";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

import erpDb from "../erpDb.js";

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

export async function hasUserApiKey(id: number): Promise<boolean> {
  const user = await erpDb.user.findUnique({
    where: { id },
    select: { apiKeyHash: true },
  });
  return !!user?.apiKeyHash;
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
  return generatePersistentUserApiKey(id, {
    userExists: async (userId) =>
      (await erpDb.user.findUnique({
        where: { id: userId },
        select: { id: true },
      })) !== null,
    updateApiKeyHash: (userId, apiKeyHash) =>
      erpDb.user.update({
        where: { id: userId },
        data: { apiKeyHash },
      }),
  });
}
