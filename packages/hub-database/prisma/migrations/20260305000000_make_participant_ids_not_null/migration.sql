-- Backfill any NULL participant_ids (shouldn't exist, but just in case)
UPDATE "mail_messages" SET "participant_ids" = '' WHERE "participant_ids" IS NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_mail_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "from_user_id" INTEGER NOT NULL,
    "host_id" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'mail',
    "participant_ids" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_messages_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "mail_messages_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_mail_messages" ("id", "from_user_id", "host_id", "kind", "participant_ids", "subject", "body", "created_at")
    SELECT "id", "from_user_id", "host_id", "kind", "participant_ids", "subject", "body", "created_at" FROM "mail_messages";
DROP TABLE "mail_messages";
ALTER TABLE "new_mail_messages" RENAME TO "mail_messages";
CREATE INDEX "idx_mail_messages_from_user_id" ON "mail_messages"("from_user_id");
CREATE INDEX "idx_mail_messages_created_at_desc" ON "mail_messages"("created_at" DESC);
CREATE INDEX "idx_mail_messages_participant_ids" ON "mail_messages"("participant_ids");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Update schema version
INSERT INTO "schema_version" ("id", "version", "updated") VALUES (1, 24, datetime('now'))
ON CONFLICT ("id") DO UPDATE SET "version" = 24, "updated" = datetime('now');
