import { SUPER_ADMIN_USERNAME } from "@naisys/common";
import { ensureSuperAdmin } from "@naisys/supervisor-database";
import bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "crypto";
import readline from "readline/promises";

import erpDb from "./erpDb.js";

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
  } else {
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

  // Warn if agent users exist without supervisor auth
  const agentCount = await erpDb.user.count({ where: { isAgent: true } });
  if (agentCount > 0) {
    console.warn(
      `[ERP] Warning: ${agentCount} agent user(s) found but supervisor auth is disabled. ` +
        `Agent API key lookups and authentication will not work. ` +
        `Start with --supervisor-auth to enable.`,
    );
  }
}

/**
 * Sync superadmin from supervisor into ERP DB and ensure permissions.
 * For supervisor auth mode.
 */
export async function ensureSupervisorSuperAdmin(): Promise<void> {
  const result = await ensureSuperAdmin();

  await erpDb.user.upsert({
    where: { uuid: result.user.uuid },
    create: {
      uuid: result.user.uuid,
      username: result.user.username,
      passwordHash: result.user.passwordHash,
      apiKey: result.user.apiKey,
    },
    update: {
      username: result.user.username,
      passwordHash: result.user.passwordHash,
      apiKey: result.user.apiKey,
    },
  });

  const localSuperAdmin = await erpDb.user.findUnique({
    where: { uuid: result.user.uuid },
  });
  if (localSuperAdmin) {
    await ensureErpAdminPermission(localSuperAdmin.id);
  }

  if (result.created) {
    console.log(
      `[ERP] ${SUPER_ADMIN_USERNAME} user created. Password: ${result.generatedPassword}`,
    );
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
