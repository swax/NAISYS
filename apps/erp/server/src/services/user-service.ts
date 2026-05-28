import { SUPER_ADMIN_USERNAME } from "@naisys/common";
import { generatePersistentUserApiKey } from "@naisys/common-node";
import type { ErpPermission } from "@naisys/erp-shared";
import {
  findHubUserTitleByUuid,
  findHubUserTitlesByUuids,
} from "@naisys/hub-database";
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
  title: string;
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

export async function createUserForAgent(
  username: string,
  uuid: string,
  title: string,
) {
  return erpDb.user.create({
    data: {
      username,
      uuid,
      title,
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
  data: { username?: string; password?: string; title?: string },
) {
  const updateData: Record<string, unknown> = {};
  if (data.username !== undefined) {
    updateData.username = data.username;
  }
  if (data.title !== undefined) {
    updateData.title = data.title;
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

  // Super admin is a non-agent — seed title from hub on first bootstrap,
  // but leave it alone afterwards so local edits stick.
  const existing = await erpDb.user.findUnique({
    where: { uuid: result.user.uuid },
  });
  if (existing) {
    if (existing.username !== result.user.username) {
      await erpDb.user.update({
        where: { id: existing.id },
        data: { username: result.user.username },
      });
    }
  } else {
    const title = (await findHubUserTitleByUuid(result.user.uuid)) ?? "";
    await erpDb.user.create({
      data: {
        uuid: result.user.uuid,
        username: result.user.username,
        title,
      },
    });
  }

  const localSuperAdmin = await erpDb.user.findUnique({
    where: { uuid: result.user.uuid },
  });
  if (localSuperAdmin) {
    await ensureErpAdminPermission(localSuperAdmin.id);
  }
}

/**
 * Pull the latest title from the hub for every agent user in ERP and update
 * any drift. Non-agents are skipped — they own their title locally. Runs at
 * ERP startup (SSO mode) so agent titles stay fresh even if the agent hasn't
 * authenticated recently to trigger the per-request refresh in auth-middleware.
 */
export async function syncAgentTitlesFromHub(): Promise<void> {
  const agents = await erpDb.user.findMany({
    where: { isAgent: true },
    select: { id: true, uuid: true, title: true },
  });
  if (agents.length === 0) return;

  const hubTitles = await findHubUserTitlesByUuids(agents.map((a) => a.uuid));

  let updated = 0;
  for (const agent of agents) {
    const hubTitle = hubTitles.get(agent.uuid);
    if (hubTitle === undefined) continue; // not in hub, leave as-is
    if (hubTitle === agent.title) continue;
    await erpDb.user.update({
      where: { id: agent.id },
      data: { title: hubTitle },
    });
    updated++;
  }

  if (updated > 0) {
    console.log(`[ERP] Synced ${updated} agent title(s) from hub.`);
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
