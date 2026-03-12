-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_context_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT,
    "type" TEXT,
    "message" TEXT NOT NULL,
    "attachment_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "context_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "context_log_user_id_run_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "context_log_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "context_log_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);
INSERT INTO "new_context_log" ("id", "user_id", "run_id", "session_id", "host_id", "role", "source", "type", "message", "attachment_id", "created_at")
    SELECT "id", "user_id", "run_id", "session_id", "host_id", "role",
        NULLIF("source", ''),
        NULLIF("type", ''),
        "message", "attachment_id", "created_at"
    FROM "context_log";
DROP TABLE "context_log";
ALTER TABLE "new_context_log" RENAME TO "context_log";
CREATE INDEX "idx_context_log_user_run_session" ON "context_log"("user_id", "run_id", "session_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
