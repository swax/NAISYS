import { SUPER_ADMIN_USERNAME } from "@naisys/common";
import {
  getAgentApiKeyByUuid,
  rotateAgentApiKeyByUuid,
} from "@naisys/hub-database";
import bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "crypto";
import readline from "readline/promises";

import erpDb from "./erpDb.js";
import { isSupervisorAuth } from "./supervisorAuth.js";

const SALT_ROUNDS = 10;

/**
 * Ensure a superadmin user exists in the local ERP database.
 * For standalone mode (no supervisor auth).
 */
export async function ensureLocalSuperAdmin(): Promise<void> {
  const existing = await erpDb.user.findUnique({
    where: { username: SUPER_ADMIN_USERNAME },
  });
  if (existing) {
    // Ensure superadmin has erp_admin permission
    await ensureErpAdminPermission(existing.id);
    return;
  }

  const password = randomUUID().slice(0, 8);
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await erpDb.user.create({
    data: {
      uuid: randomUUID(),
      username: SUPER_ADMIN_USERNAME,
      passwordHash: hash,
      apiKey: randomBytes(32).toString("hex"),
    },
  });

  await ensureErpAdminPermission(user.id);

  console.log(
    `\n  ${SUPER_ADMIN_USERNAME} user created. Password: ${password}`,
  );
  console.log(`  Change it via --reset-password\n`);
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

/**
 * Interactive CLI to reset a local user's password.
 * For standalone mode (no supervisor auth).
 */
export async function resetLocalPassword(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const username = await rl.question("Username: ");
    const user = await erpDb.user.findUnique({ where: { username } });
    if (!user) {
      console.error(`User '${username}' not found.`);
      process.exit(1);
    }

    const password = await rl.question("New password: ");
    if (password.length < 6) {
      console.error("Password must be at least 6 characters.");
      process.exit(1);
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await erpDb.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });

    console.log(`Password reset for '${username}'.`);
  } finally {
    rl.close();
  }
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
    erpDb.user.findMany({
      where,
      include: { permissions: true },
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
    include: { permissions: true },
  });
}

export async function getUserById(id: number) {
  return erpDb.user.findUnique({
    where: { id },
    include: { permissions: true },
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
    include: { permissions: true },
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
    include: { permissions: true },
  });
}

export async function deleteUser(id: number) {
  return erpDb.user.delete({ where: { id } });
}

export async function grantPermission(
  userId: number,
  permission: string,
  grantedBy: number,
) {
  return erpDb.userPermission.create({
    data: { userId, permission, grantedBy },
  });
}

export async function revokePermission(userId: number, permission: string) {
  return erpDb.userPermission.deleteMany({
    where: { userId, permission },
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
