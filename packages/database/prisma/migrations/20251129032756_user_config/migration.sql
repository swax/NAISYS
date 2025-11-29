-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agent_path" TEXT NOT NULL,
    "lead_username" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO "new_users" ("agent_path", "id", "lead_username", "title", "username") SELECT "agent_path", "id", "lead_username", "title", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "unq_users_username" ON "users"("username");
CREATE UNIQUE INDEX "unq_users_agent_path" ON "users"("agent_path");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
