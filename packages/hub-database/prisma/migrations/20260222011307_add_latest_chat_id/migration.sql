-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_notifications" (
    "user_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "latest_host_id" INTEGER,
    "latest_log_id" INTEGER NOT NULL DEFAULT 0,
    "latest_mail_id" INTEGER NOT NULL DEFAULT 0,
    "latest_chat_id" INTEGER NOT NULL DEFAULT 0,
    "last_active" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "user_notifications_latest_host_id_fkey" FOREIGN KEY ("latest_host_id") REFERENCES "hosts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_user_notifications" ("last_active", "latest_host_id", "latest_log_id", "latest_mail_id", "updated_at", "user_id") SELECT "last_active", "latest_host_id", "latest_log_id", "latest_mail_id", "updated_at", "user_id" FROM "user_notifications";
DROP TABLE "user_notifications";
ALTER TABLE "new_user_notifications" RENAME TO "user_notifications";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
