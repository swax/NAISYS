-- Replace persisted plaintext user API keys with nullable hashes.
-- Existing plaintext keys are intentionally discarded.

DROP INDEX IF EXISTS "users_api_key_key";

ALTER TABLE "users" RENAME COLUMN "api_key" TO "api_key_hash";

UPDATE "users" SET "api_key_hash" = NULL;

CREATE UNIQUE INDEX "users_api_key_hash_key" ON "users"("api_key_hash");
