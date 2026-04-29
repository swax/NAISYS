import { hashToken } from "@naisys/common-node";
import bcrypt from "bcryptjs";

import { getSupervisorDb } from "./sessionService.js";

const SALT_ROUNDS = 12;
const MAX_BCRYPT_PASSWORD_BYTES = 72;
const DUMMY_PASSWORD_HASH =
  "$2b$12$fVdOkEetDLihAbUSW2W95eUM92DDTiMcrfe103K2l3RCaQmgGG9NC";

export class PasswordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordValidationError";
  }
}

export async function hashPassword(password: string): Promise<string> {
  // Length is already enforced by the request schema; only the bcrypt byte
  // ceiling can fail past validation (multi-byte chars within the char limit).
  if (Buffer.byteLength(password, "utf8") > MAX_BCRYPT_PASSWORD_BYTES) {
    throw new PasswordValidationError(
      `Password must be ${MAX_BCRYPT_PASSWORD_BYTES} bytes or fewer.`,
    );
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (Buffer.byteLength(password, "utf8") > MAX_BCRYPT_PASSWORD_BYTES) {
    return false;
  }
  // Always run bcrypt — using DUMMY_PASSWORD_HASH for missing users keeps the
  // response time constant. The Boolean(passwordHash) guard then rejects the
  // (negligible) chance the attacker's input bcrypt-matches the dummy.
  const hashToCompare = passwordHash ?? DUMMY_PASSWORD_HASH;
  const matches = await bcrypt.compare(password, hashToCompare);
  return Boolean(passwordHash) && matches;
}

export async function userHasPassword(userId: number): Promise<boolean> {
  const db = getSupervisorDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  return Boolean(user?.passwordHash);
}

export async function clearUserPassword(userId: number): Promise<void> {
  const db = getSupervisorDb();
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: null },
  });
}

export async function verifyUserPassword(
  userId: number,
  password: string,
): Promise<boolean> {
  const db = getSupervisorDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  return verifyPassword(password, user?.passwordHash);
}

export async function consumeTokenAndSetPassword(input: {
  token: string;
  password: string;
}): Promise<{ userId: number; username: string } | null> {
  const passwordHash = await hashPassword(input.password);
  const db = getSupervisorDb();
  const tokenHash = hashToken(input.token);

  return db.$transaction(async (tx) => {
    const updated = await tx.registrationToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (updated.count === 0) return null;

    const record = await tx.registrationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record) return null;

    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });

    return { userId: record.userId, username: record.user.username };
  });
}
