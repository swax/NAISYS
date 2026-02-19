import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import readline from "readline/promises";
import prisma from "./db.js";

/**
 * Ensure a superadmin user exists in the local ERP database.
 * For standalone mode (no supervisor auth).
 */
export async function ensureLocalSuperAdmin(): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { username: "superadmin" },
  });
  if (existing) return;

  const password = randomUUID().slice(0, 8);
  const hash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: { uuid: randomUUID(), username: "superadmin", passwordHash: hash },
  });

  console.log(`\n  superadmin user created. Password: ${password}`);
  console.log(`  Change it via --reset-password\n`);
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
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      console.error(`User '${username}' not found.`);
      process.exit(1);
    }

    const password = await rl.question("New password: ");
    if (password.length < 6) {
      console.error("Password must be at least 6 characters.");
      process.exit(1);
    }

    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });

    console.log(`Password reset for '${username}'.`);
  } finally {
    rl.close();
  }
}
