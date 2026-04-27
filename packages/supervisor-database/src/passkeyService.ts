import { hashToken } from "@naisys/common-node";
import { randomBytes } from "crypto";

import { getSupervisorDb } from "./sessionService.js";

const REGISTRATION_TOKEN_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface ConsumeAndStoreInput {
  token: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceLabel?: string;
}

export interface ConsumeAndStoreResult {
  userId: number;
  username: string;
}

export interface PasskeyCredentialRecord {
  id: number;
  userId: number;
  username: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string;
  deviceLabel: string;
}

export interface PasskeyCredentialSummary {
  id: number;
  credentialId: string;
  deviceLabel: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function createPasskeyCredential(input: {
  userId: number;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceLabel?: string;
}): Promise<void> {
  const db = getSupervisorDb();
  await db.passkeyCredential.create({
    data: {
      userId: input.userId,
      credentialId: input.credentialId,
      publicKey: input.publicKey,
      counter: input.counter,
      transports: input.transports.join(","),
      deviceLabel: input.deviceLabel ?? "",
    },
  });
}

export async function findPasskeyCredentialByCredentialId(
  credentialId: string,
): Promise<PasskeyCredentialRecord | null> {
  const db = getSupervisorDb();
  const cred = await db.passkeyCredential.findUnique({
    where: { credentialId },
    include: { user: true },
  });
  if (!cred) return null;
  return {
    id: cred.id,
    userId: cred.userId,
    username: cred.user.username,
    credentialId: cred.credentialId,
    publicKey: cred.publicKey,
    counter: cred.counter,
    transports: cred.transports,
    deviceLabel: cred.deviceLabel,
  };
}

export async function listPasskeyCredentialsForUser(
  userId: number,
): Promise<PasskeyCredentialSummary[]> {
  const db = getSupervisorDb();
  const creds = await db.passkeyCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return creds.map((c) => ({
    id: c.id,
    credentialId: c.credentialId,
    deviceLabel: c.deviceLabel,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  }));
}

export async function listPasskeyCredentialIdsForUser(
  userId: number,
): Promise<{ credentialId: string; transports: string }[]> {
  const db = getSupervisorDb();
  const creds = await db.passkeyCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  return creds;
}

export async function updatePasskeyCounter(
  credentialId: string,
  counter: number,
): Promise<void> {
  const db = getSupervisorDb();
  await db.passkeyCredential.update({
    where: { credentialId },
    data: { counter, lastUsedAt: new Date() },
  });
}

export async function deletePasskeyCredential(
  id: number,
  userId: number,
): Promise<boolean> {
  const db = getSupervisorDb();
  const result = await db.passkeyCredential.deleteMany({
    where: { id, userId },
  });
  return result.count > 0;
}

export async function deleteAllPasskeyCredentialsForUser(
  userId: number,
): Promise<number> {
  const db = getSupervisorDb();
  const result = await db.passkeyCredential.deleteMany({
    where: { userId },
  });
  return result.count;
}

/**
 * Issue a single-use registration token for a user. Any existing unused tokens
 * for the user are revoked first. Returns the plaintext token (caller must
 * deliver it to the operator out-of-band — only the hash is persisted).
 */
export async function issueRegistrationToken(
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const db = getSupervisorDb();
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + REGISTRATION_TOKEN_DURATION_MS);

  await db.registrationToken.deleteMany({
    where: { userId, usedAt: null },
  });

  await db.registrationToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { token, expiresAt };
}

/**
 * Look up a registration token without consuming it. Returns the userId if the
 * token is valid (not used, not expired), null otherwise.
 */
export async function lookupRegistrationToken(
  token: string,
): Promise<{ userId: number; username: string } | null> {
  const db = getSupervisorDb();
  const tokenHash = hashToken(token);
  const record = await db.registrationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!record) return null;
  if (record.usedAt) return null;
  if (record.expiresAt < new Date()) return null;
  return { userId: record.userId, username: record.user.username };
}

/**
 * Atomically consume a registration token and store a passkey credential as
 * a single transaction. Either both happen or neither does — this closes the
 * race where two requests carrying the same one-time token could each pass a
 * non-atomic `lookup → store → consume` flow and end up registering two
 * credentials.
 *
 * Returns the user that owns the now-consumed token, or null if the token was
 * already used / expired / unknown.
 */
export async function consumeTokenAndStoreCredential(
  input: ConsumeAndStoreInput,
): Promise<ConsumeAndStoreResult | null> {
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

    await tx.passkeyCredential.create({
      data: {
        userId: record.userId,
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        counter: input.counter,
        transports: input.transports.join(","),
        deviceLabel: input.deviceLabel ?? "",
      },
    });

    return { userId: record.userId, username: record.user.username };
  });
}

export async function hasActiveRegistrationToken(
  userId: number,
): Promise<boolean> {
  const db = getSupervisorDb();
  const count = await db.registrationToken.count({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
  });
  return count > 0;
}

export async function userHasPasskey(userId: number): Promise<boolean> {
  const db = getSupervisorDb();
  const count = await db.passkeyCredential.count({ where: { userId } });
  return count > 0;
}
