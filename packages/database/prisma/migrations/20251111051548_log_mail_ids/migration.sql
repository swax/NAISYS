-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agent_path" TEXT NOT NULL,
    "lead_username" TEXT,
    "latest_log_id" INTEGER NOT NULL DEFAULT -1,
    "latest_mail_id" INTEGER NOT NULL DEFAULT -1
);
INSERT INTO "new_users" ("agent_path", "id", "lead_username", "title", "username") SELECT "agent_path", "id", "lead_username", "title", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "unq_users_username" ON "users"("username");
CREATE UNIQUE INDEX "unq_users_agent_path" ON "users"("agent_path");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "schema_version" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "version" INTEGER NOT NULL,
    "updated" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "unq_schema_version_version" ON "schema_version"("version");


