/*
  Warnings:

  - You are about to drop the column `latest_mail_id` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `modified_date` on the `users` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "user_notifications" (
    "user_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "latest_mail_id" INTEGER NOT NULL DEFAULT -1,
    "latest_log_id" INTEGER NOT NULL DEFAULT -1,
    "last_active" DATETIME NOT NULL,
    "modified_date" DATETIME NOT NULL,
    CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agent_path" TEXT NOT NULL,
    "lead_username" TEXT
);
INSERT INTO "new_users" ("agent_path", "id", "lead_username", "title", "username") SELECT "agent_path", "id", "lead_username", "title", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "unq_users_username" ON "users"("username");
CREATE UNIQUE INDEX "unq_users_agent_path" ON "users"("agent_path");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
