-- AlterTable: remove agent_path column from users
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "api_key" TEXT,
    "lead_user_id" INTEGER,
    "config" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "users_lead_user_id_fkey" FOREIGN KEY ("lead_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
INSERT INTO "new_users" ("id", "uuid", "username", "title", "api_key", "lead_user_id", "config", "created_at", "updated_at", "archived") SELECT "id", "uuid", "username", "title", "api_key", "lead_user_id", "config", "created_at", "updated_at", "archived" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");
CREATE UNIQUE INDEX "users_api_key_key" ON "users"("api_key");
CREATE INDEX "idx_users_username" ON "users"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
