-- Add subagent_id discriminator to run_session, context_log, and costs.
-- Sentinel value 0 means "main agent activity"; negative values are
-- ephemeral subagent ids minted on the runner host.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Recreate run_session with subagent_id as part of the compound primary key.
CREATE TABLE "new_run_session" (
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "subagent_id" INTEGER NOT NULL DEFAULT 0,
    "session_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "last_active" DATETIME NOT NULL,
    "model_name" TEXT NOT NULL,
    "latest_log_id" INTEGER NOT NULL DEFAULT 0,
    "total_lines" INTEGER NOT NULL DEFAULT 0,
    "total_cost" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("user_id", "run_id", "subagent_id", "session_id"),
    CONSTRAINT "run_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "run_session_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_run_session" (
    "user_id", "run_id", "subagent_id", "session_id", "host_id",
    "last_active", "model_name", "latest_log_id", "total_lines",
    "total_cost", "created_at", "updated_at"
)
SELECT
    "user_id", "run_id", 0, "session_id", "host_id",
    "last_active", "model_name", "latest_log_id", "total_lines",
    "total_cost", "created_at", "updated_at"
FROM "run_session";

DROP TABLE "run_session";
ALTER TABLE "new_run_session" RENAME TO "run_session";

CREATE INDEX "idx_run_session_run_id_desc" ON "run_session"("run_id" DESC);
CREATE INDEX "idx_run_session_user_last_active_desc" ON "run_session"("user_id", "last_active" DESC);

-- Recreate context_log with subagent_id and updated composite FK.
CREATE TABLE "new_context_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "subagent_id" INTEGER NOT NULL DEFAULT 0,
    "session_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT,
    "type" TEXT,
    "message" TEXT NOT NULL,
    "attachment_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "context_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "context_log_user_id_run_id_subagent_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "subagent_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "subagent_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "context_log_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "context_log_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_context_log" (
    "id", "user_id", "run_id", "subagent_id", "session_id", "host_id",
    "role", "source", "type", "message", "attachment_id", "created_at"
)
SELECT
    "id", "user_id", "run_id", 0, "session_id", "host_id",
    "role", "source", "type", "message", "attachment_id", "created_at"
FROM "context_log";

DROP TABLE "context_log";
ALTER TABLE "new_context_log" RENAME TO "context_log";

CREATE INDEX "idx_context_log_user_run_subagent_session" ON "context_log"("user_id", "run_id", "subagent_id", "session_id");

-- Recreate costs with subagent_id and updated composite FK.
CREATE TABLE "new_costs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "subagent_id" INTEGER NOT NULL DEFAULT 0,
    "session_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cost" REAL DEFAULT 0,
    "input_tokens" INTEGER DEFAULT 0,
    "output_tokens" INTEGER DEFAULT 0,
    "cache_write_tokens" INTEGER DEFAULT 0,
    "cache_read_tokens" INTEGER DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "costs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "costs_user_id_run_id_subagent_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "subagent_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "subagent_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "costs_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_costs" (
    "id", "user_id", "run_id", "subagent_id", "session_id", "host_id",
    "source", "model", "cost", "input_tokens", "output_tokens",
    "cache_write_tokens", "cache_read_tokens", "created_at"
)
SELECT
    "id", "user_id", "run_id", 0, "session_id", "host_id",
    "source", "model", "cost", "input_tokens", "output_tokens",
    "cache_write_tokens", "cache_read_tokens", "created_at"
FROM "costs";

DROP TABLE "costs";
ALTER TABLE "new_costs" RENAME TO "costs";

CREATE INDEX "idx_costs_created_at" ON "costs"("created_at");
CREATE INDEX "idx_costs_user_id" ON "costs"("user_id");
CREATE INDEX "idx_costs_user_run_subagent_session_source_model" ON "costs"("user_id", "run_id", "subagent_id", "session_id", "source", "model");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
