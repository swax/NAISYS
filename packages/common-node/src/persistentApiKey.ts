import { randomBytes } from "crypto";

import { hashToken } from "./hashToken.js";

export interface GeneratePersistentUserApiKeyOptions {
  userExists: (userId: number) => Promise<boolean>;
  updateApiKeyHash: (userId: number, apiKeyHash: string) => Promise<unknown>;
}

/**
 * Generate or replace a persistent ("external") user API key. Independent of
 * the hub-issued runtime key — both human users and agent users may have one.
 * Returns the plaintext key once; callers store only the returned hash.
 */
export async function generatePersistentUserApiKey(
  userId: number,
  { userExists, updateApiKeyHash }: GeneratePersistentUserApiKeyOptions,
): Promise<string> {
  const apiKey = randomBytes(32).toString("hex");

  if (!(await userExists(userId))) throw new Error("User not found");

  await updateApiKeyHash(userId, hashToken(apiKey));

  return apiKey;
}
