-- CreateTable
CREATE TABLE "context_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    CONSTRAINT "context_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "context_log_user_id_run_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "costs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "subagent" TEXT,
    "source" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cost" REAL DEFAULT 0,
    "input_tokens" INTEGER DEFAULT 0,
    "output_tokens" INTEGER DEFAULT 0,
    "cache_write_tokens" INTEGER DEFAULT 0,
    "cache_read_tokens" INTEGER DEFAULT 0,
    CONSTRAINT "costs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "costs_user_id_run_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "dream_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "dream" TEXT NOT NULL,
    CONSTRAINT "dream_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "dream_log_user_id_run_id_session_id_fkey" FOREIGN KEY ("user_id", "run_id", "session_id") REFERENCES "run_session" ("user_id", "run_id", "session_id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "thread_members" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "thread_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "new_msg_id" INTEGER NOT NULL DEFAULT -1,
    "archived" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "thread_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "thread_members_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "thread_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "thread_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    CONSTRAINT "thread_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "thread_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "threads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "subject" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agent_path" TEXT NOT NULL,
    "lead_username" TEXT
);

-- CreateTable
CREATE TABLE "run_session" (
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "start_date" TEXT NOT NULL,
    "last_active" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "total_lines" INTEGER NOT NULL DEFAULT 0,
    "total_cost" REAL NOT NULL DEFAULT 0,

    PRIMARY KEY ("user_id", "run_id", "session_id"),
    CONSTRAINT "run_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
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
CREATE INDEX "idx_costs_date" ON "costs"("date");

-- CreateIndex
CREATE INDEX "idx_dream_log_id_desc" ON "dream_log"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_dream_log_user_id" ON "dream_log"("user_id");

-- CreateIndex
CREATE INDEX "idx_dream_log_run_session" ON "dream_log"("user_id", "run_id", "session_id");

-- CreateIndex
CREATE INDEX "idx_thread_members_thread_id" ON "thread_members"("thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "unq_thread_members_thread_id_user_id" ON "thread_members"("thread_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_thread_messages_thread_id" ON "thread_messages"("thread_id");

-- CreateIndex
CREATE INDEX "idx_thread_messages_id_desc" ON "thread_messages"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_threads_id_desc" ON "threads"("id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "unq_users_username" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "unq_users_agent_path" ON "users"("agent_path");

-- CreateIndex
CREATE INDEX "idx_run_session_user_id" ON "run_session"("user_id");

-- CreateIndex
CREATE INDEX "idx_run_session_last_active" ON "run_session"("last_active");
