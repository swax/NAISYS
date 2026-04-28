-- Make users.password_hash nullable. NULL means the user is not
-- password-authable (passkey-only, API-key-only, or agent).
-- Existing sentinel values are converted to NULL.

PRAGMA foreign_keys=OFF;

CREATE TABLE "users_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT,
    "is_agent" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "api_key_hash" TEXT
);

INSERT INTO "users_new" ("id", "uuid", "username", "password_hash", "is_agent", "created_at", "updated_at", "deleted_at", "api_key_hash")
SELECT
    "id",
    "uuid",
    "username",
    CASE WHEN "password_hash" IN ('!sso-passkey-only', '!api-key-only', '') THEN NULL ELSE "password_hash" END,
    "is_agent",
    "created_at",
    "updated_at",
    "deleted_at",
    "api_key_hash"
FROM "users";

DROP TABLE "users";
ALTER TABLE "users_new" RENAME TO "users";

CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_api_key_hash_key" ON "users"("api_key_hash");

PRAGMA foreign_keys=ON;
