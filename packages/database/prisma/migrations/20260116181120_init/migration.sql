-- CreateTable
CREATE TABLE "context_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    CONSTRAINT "context_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "context_log_user_id_run_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "costs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cost" REAL DEFAULT 0,
    "input_tokens" INTEGER DEFAULT 0,
    "output_tokens" INTEGER DEFAULT 0,
    "cache_write_tokens" INTEGER DEFAULT 0,
    "cache_read_tokens" INTEGER DEFAULT 0,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "costs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "costs_user_id_run_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_user_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_messages_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "mail_recipients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_recipients_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "mail_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "mail_status" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" DATETIME,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_status_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "mail_status_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agent_path" TEXT NOT NULL,
    "lead_username" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "host_id" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "users_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "latest_mail_id" TEXT NOT NULL DEFAULT '',
    "latest_log_id" TEXT NOT NULL DEFAULT '',
    "last_active" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "run_session" (
    "user_id" TEXT NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "start_date" DATETIME NOT NULL,
    "last_active" DATETIME NOT NULL,
    "model_name" TEXT NOT NULL,
    "latest_log_id" TEXT NOT NULL DEFAULT '',
    "total_lines" INTEGER NOT NULL DEFAULT 0,
    "total_cost" REAL NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("user_id", "run_id", "session_id"),
    CONSTRAINT "run_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "schema_version" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "version" INTEGER NOT NULL,
    "updated" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "hosts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "idx_context_log_id_desc" ON "context_log"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_context_log_user_id" ON "context_log"("user_id");

-- CreateIndex
CREATE INDEX "idx_context_log_run_session" ON "context_log"("user_id", "run_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_costs_id_desc" ON "costs"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_costs_user_id" ON "costs"("user_id");

-- CreateIndex
CREATE INDEX "idx_costs_run_session" ON "costs"("user_id", "run_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_costs_aggregation_key" ON "costs"("user_id", "run_id", "session_id", "source", "model");

-- CreateIndex
CREATE INDEX "idx_mail_messages_id_desc" ON "mail_messages"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_mail_messages_from_user_id" ON "mail_messages"("from_user_id");

-- CreateIndex
CREATE INDEX "idx_mail_recipients_message_id" ON "mail_recipients"("message_id");

-- CreateIndex
CREATE INDEX "idx_mail_recipients_user_id" ON "mail_recipients"("user_id");

-- CreateIndex
CREATE INDEX "idx_mail_status_user_id" ON "mail_status"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "unq_mail_status_message_user" ON "mail_status"("message_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "unq_users_username" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "unq_users_agent_path" ON "users"("agent_path");

-- CreateIndex
CREATE INDEX "idx_users_host_id" ON "users"("host_id");

-- CreateIndex
CREATE INDEX "idx_run_session_user_id" ON "run_session"("user_id");

-- CreateIndex
CREATE INDEX "idx_run_session_last_active" ON "run_session"("last_active");

-- CreateIndex
CREATE UNIQUE INDEX "unq_schema_version_version" ON "schema_version"("version");

-- CreateIndex
CREATE UNIQUE INDEX "unq_hosts_name" ON "hosts"("name");
