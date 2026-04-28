import { SUPER_ADMIN_USERNAME } from "@naisys/common";
import { ensureSuperAdmin } from "@naisys/supervisor-database";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

import erpDb from "./erpDb.js";

const SALT_ROUNDS = 10;

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
