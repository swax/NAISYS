import { hashToken } from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import { randomBytes } from "crypto";

import type { HubRedactionService } from "./hubRedactionService.js";

/**
 * Mints and revokes per-user runtime API keys. 32 random bytes; only the
 * hash is persisted. Plaintext is registered with the redactor on issue so
 * leaks get scrubbed; the user's Set is cleared on revoke.
 */
export function createHubRuntimeKeyService(
  { hubDb }: HubDatabaseService,
  redactionService: HubRedactionService,
) {
  async function issueRuntimeApiKey(userId: number): Promise<string> {
    const token = randomBytes(32).toString("hex");
    await hubDb.users.update({
      where: { id: userId },
      data: { api_key_hash: hashToken(token) },
    });
    redactionService.registerRuntimeApiKey(userId, token);
    return token;
  }

  async function revokeRuntimeApiKey(userId: number): Promise<void> {
    await hubDb.users.update({
      where: { id: userId },
      data: { api_key_hash: null },
    });
    redactionService.revokeRuntimeApiKey(userId);
  }

  return { issueRuntimeApiKey, revokeRuntimeApiKey };
}

export type HubRuntimeKeyService = ReturnType<typeof createHubRuntimeKeyService>;
