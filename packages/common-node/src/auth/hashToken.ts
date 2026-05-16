import { createHash } from "crypto";

/** Hash a token (session cookie, API key) with SHA-256 for safe cache keys / DB lookup. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
