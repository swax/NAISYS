-- CreateTable
CREATE TABLE "context_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "host_id" TEXT,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "context_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "context_log_user_id_run_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "context_log_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("host_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "costs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "host_id" TEXT,
    "source" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cost" REAL DEFAULT 0,
    "input_tokens" INTEGER DEFAULT 0,
    "output_tokens" INTEGER DEFAULT 0,
    "cache_write_tokens" INTEGER DEFAULT 0,
    "cache_read_tokens" INTEGER DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "costs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "costs_user_id_run_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "costs_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("host_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_user_id" TEXT NOT NULL,
    "host_id" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_messages_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "mail_messages_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("host_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mail_recipients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "host_id" TEXT,
    "type" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_recipients_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "mail_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "mail_recipients_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("host_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mail_status" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "host_id" TEXT,
    "read_at" DATETIME,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_status_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "mail_status_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "mail_status_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("host_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agent_path" TEXT NOT NULL,
    "lead_user_id" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "host_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "users_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("host_id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "users_lead_user_id_fkey" FOREIGN KEY ("lead_user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "host_id" TEXT,
    "latest_log_id" TEXT NOT NULL DEFAULT '',
    "last_active" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "user_notifications_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("host_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_session" (
    "user_id" TEXT NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "host_id" TEXT,
    "last_active" DATETIME NOT NULL,
    "model_name" TEXT NOT NULL,
    "latest_log_id" TEXT NOT NULL DEFAULT '',
    "total_lines" INTEGER NOT NULL DEFAULT 0,
    "total_cost" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("user_id", "run_id", "session_id"),
    CONSTRAINT "run_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "run_session_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("host_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "schema_version" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "version" INTEGER NOT NULL,
    "updated" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "hosts" (
    "host_id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "last_active" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "hub_sync_state" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "since_timestamp" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "idx_context_log_id_desc" ON "context_log"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_context_log_run_session" ON "context_log"("user_id", "run_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_context_log_sync" ON "context_log"("host_id", "id");

-- CreateIndex
CREATE INDEX "idx_costs_id_desc" ON "costs"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_costs_user_id" ON "costs"("user_id");

-- CreateIndex
CREATE INDEX "idx_costs_aggregation_key" ON "costs"("user_id", "run_id", "session_id", "source", "model");

-- CreateIndex
CREATE INDEX "idx_costs_sync" ON "costs"("host_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_mail_messages_id_desc" ON "mail_messages"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_mail_messages_from_user_id" ON "mail_messages"("from_user_id");

-- CreateIndex
CREATE INDEX "idx_mail_messages_created_at" ON "mail_messages"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_mail_messages_sync" ON "mail_messages"("host_id", "id");

-- CreateIndex
CREATE INDEX "idx_mail_messages_updated_at" ON "mail_messages"("updated_at");

-- CreateIndex
CREATE INDEX "idx_mail_recipients_message_id" ON "mail_recipients"("message_id");

-- CreateIndex
CREATE INDEX "idx_mail_recipients_user_id" ON "mail_recipients"("user_id", "message_id" DESC);

-- CreateIndex
CREATE INDEX "idx_mail_recipients_sync" ON "mail_recipients"("host_id", "id");

-- CreateIndex
CREATE INDEX "idx_mail_recipients_updated_at" ON "mail_recipients"("updated_at");

-- CreateIndex
CREATE INDEX "idx_mail_status_user_id" ON "mail_status"("user_id");

-- CreateIndex
CREATE INDEX "idx_mail_status_sync" ON "mail_status"("host_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_mail_status_updated_at" ON "mail_status"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "unq_mail_status_message_user" ON "mail_status"("message_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "unq_users_agent_path" ON "users"("agent_path");

-- CreateIndex
CREATE INDEX "idx_users_sync" ON "users"("host_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_users_updated_at" ON "users"("updated_at");

-- CreateIndex
CREATE INDEX "idx_users_lead_lookup" ON "users"("lead_user_id", "host_id");

-- CreateIndex
CREATE UNIQUE INDEX "unq_users_username_host" ON "users"("username", "host_id");

-- CreateIndex
CREATE INDEX "idx_user_notifications_sync" ON "user_notifications"("host_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_user_notifications_updated_at" ON "user_notifications"("updated_at");

-- CreateIndex
CREATE INDEX "idx_run_session_user_active" ON "run_session"("user_id", "last_active" DESC);

-- CreateIndex
CREATE INDEX "idx_run_session_sync" ON "run_session"("host_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "unq_schema_version_version" ON "schema_version"("version");

-- CreateIndex
CREATE UNIQUE INDEX "unq_hosts_name" ON "hosts"("name");

-- CreateIndex
CREATE INDEX "idx_hosts_updated_at" ON "hosts"("updated_at");
