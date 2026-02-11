import { createHash } from "crypto";
import {
  runOnSupervisorDb,
  selectFromSupervisorDb,
} from "../database/supervisorDatabase.js";

export interface SupervisorUserRow {
  id: number;
  username: string;
  password_hash: string;
  session_token_hash: string | null;
  session_expires_at: string | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getUserByUsername(
  username: string,
): Promise<SupervisorUserRow | null> {
  const rows = await selectFromSupervisorDb<SupervisorUserRow[]>(
    "SELECT id, username, password_hash, session_token_hash, session_expires_at FROM users WHERE username = ?",
    [username],
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

export async function getUserByTokenHash(
  tokenHash: string,
): Promise<SupervisorUserRow | null> {
  const rows = await selectFromSupervisorDb<SupervisorUserRow[]>(
    "SELECT id, username, password_hash, session_token_hash, session_expires_at FROM users WHERE session_token_hash = ? AND session_expires_at > datetime('now')",
    [tokenHash],
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

export async function setSessionOnUser(
  userId: number,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await runOnSupervisorDb(
    "UPDATE users SET session_token_hash = ?, session_expires_at = ?, updated_at = datetime('now') WHERE id = ?",
    [tokenHash, expiresAt.toISOString(), userId],
  );
}

export async function clearSessionOnUser(userId: number): Promise<void> {
  await runOnSupervisorDb(
    "UPDATE users SET session_token_hash = NULL, session_expires_at = NULL, updated_at = datetime('now') WHERE id = ?",
    [userId],
  );
}
