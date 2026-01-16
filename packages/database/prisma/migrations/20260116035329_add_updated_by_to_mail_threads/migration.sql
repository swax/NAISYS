-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_mail_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subject" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_threads_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
INSERT INTO "new_mail_threads" ("id", "subject", "token_count", "updated_at") SELECT "id", "subject", "token_count", "updated_at" FROM "mail_threads";
DROP TABLE "mail_threads";
ALTER TABLE "new_mail_threads" RENAME TO "mail_threads";
CREATE INDEX "idx_mail_threads_id_desc" ON "mail_threads"("id" DESC);
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
