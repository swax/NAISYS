-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_notifications" (
    "user_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "latest_mail_id" INTEGER NOT NULL DEFAULT -1,
    "latest_log_id" INTEGER NOT NULL DEFAULT -1,
    "last_active" DATETIME,
    "modified_date" DATETIME NOT NULL,
    CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
INSERT INTO "new_user_notifications" ("last_active", "latest_log_id", "latest_mail_id", "modified_date", "user_id") SELECT "last_active", "latest_log_id", "latest_mail_id", "modified_date", "user_id" FROM "user_notifications";
DROP TABLE "user_notifications";
ALTER TABLE "new_user_notifications" RENAME TO "user_notifications";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
