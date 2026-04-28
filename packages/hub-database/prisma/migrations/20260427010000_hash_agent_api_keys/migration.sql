-- Replace persisted plaintext agent API keys with nullable runtime token hashes.
-- Existing plaintext keys are intentionally discarded.

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "api_key_hash" TEXT,
    "lead_user_id" INTEGER,
    "config" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "users_lead_user_id_fkey" FOREIGN KEY ("lead_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

INSERT INTO "new_users" (
    "id",
    "uuid",
    "username",
    "title",
    "api_key_hash",
    "lead_user_id",
    "config",
    "created_at",
    "updated_at",
    "enabled",
    "archived"
)
SELECT
    "id",
    "uuid",
    "username",
    "title",
    NULL,
    "lead_user_id",
    "config",
    "created_at",
    "updated_at",
    "enabled",
    "archived"
FROM "users";

DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";

CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_api_key_hash_key" ON "users"("api_key_hash");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
