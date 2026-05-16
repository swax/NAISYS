import { SUPER_ADMIN_USERNAME } from "@naisys/common";
import { generatePersistentUserApiKey } from "@naisys/common-node";
import type { ErpPermission } from "@naisys/erp-shared";
import { ensureSuperAdmin } from "@naisys/supervisor-database";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

import erpDb from "../database/erpDb.js";

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

// --- Superadmin bootstrap ---

/**
 * Ensure a superadmin user exists in the local ERP database.
 * If a password is supplied, it is used on create and updates the existing one if present.
 * For standalone mode (no supervisor auth).
 */
export async function ensureLocalSuperAdmin(password?: string): Promise<void> {
  const existing = await erpDb.user.findUnique({
    where: { username: SUPER_ADMIN_USERNAME },
  });
  if (existing) {
    await ensureErpAdminPermission(existing.id);
    if (password) {
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      await erpDb.user.update({
        where: { id: existing.id },
        data: { passwordHash: hash },
      });
    }
  } else {
    const finalPassword = password || randomUUID().slice(0, 8);
    const hash = await bcrypt.hash(finalPassword, SALT_ROUNDS);

    const user = await erpDb.user.create({
      data: {
        uuid: randomUUID(),
        username: SUPER_ADMIN_USERNAME,
        passwordHash: hash,
      },
    });

    await ensureErpAdminPermission(user.id);

    if (!password) {
      console.log(
        `\n  ${SUPER_ADMIN_USERNAME} user created. Password: ${finalPassword}`,
      );
      console.log(`  Change it via the admin UI or with --setup\n`);
    }
  }

  // Warn if agent users exist without supervisor auth
  const agentCount = await erpDb.user.count({ where: { isAgent: true } });
  if (agentCount > 0) {
    console.warn(
      `[ERP] Warning: ${agentCount} agent user(s) found but supervisor auth is disabled. ` +
        `Agent API key lookups and authentication will not work. ` +
        `Set SUPERVISOR_AUTH=true to enable.`,
    );
  }
}

/**
 * Sync superadmin from supervisor into ERP DB and ensure permissions.
 * For supervisor auth mode. Supervisor uses passkey-only auth — the
 * mirrored ERP row has no passwordHash.
 */
export async function ensureSupervisorSuperAdmin(): Promise<void> {
  const result = await ensureSuperAdmin();

  await erpDb.user.upsert({
    where: { uuid: result.user.uuid },
    create: {
      uuid: result.user.uuid,
      username: result.user.username,
    },
    update: {
      username: result.user.username,
    },
  });

  const localSuperAdmin = await erpDb.user.findUnique({
    where: { uuid: result.user.uuid },
  });
  if (localSuperAdmin) {
    await ensureErpAdminPermission(localSuperAdmin.id);
  }
}

/**
 * Ensure a user has the erp_admin permission.
 */
export async function ensureErpAdminPermission(userId: number): Promise<void> {
  const existing = await erpDb.userPermission.findUnique({
    where: { userId_permission: { userId, permission: "erp_admin" } },
  });
  if (!existing) {
    await erpDb.userPermission.create({
      data: { userId, permission: "erp_admin" },
    });
  }
}
