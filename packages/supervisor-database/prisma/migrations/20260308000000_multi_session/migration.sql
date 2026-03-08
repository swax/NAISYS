-- CreateTable
CREATE TABLE "sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- Migrate existing sessions
INSERT INTO "sessions" ("user_id", "token_hash", "expires_at", "created_at")
SELECT "id", "session_token_hash", "session_expires_at", CURRENT_TIMESTAMP
FROM "users"
WHERE "session_token_hash" IS NOT NULL AND "session_expires_at" IS NOT NULL;

-- DropColumns
ALTER TABLE "users" DROP COLUMN "session_token_hash";
ALTER TABLE "users" DROP COLUMN "session_expires_at";
