-- CreateTable
CREATE TABLE "context_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "date" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "costs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "subagent" TEXT,
    "source" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cost" REAL DEFAULT 0,
    "input_tokens" INTEGER DEFAULT 0,
    "output_tokens" INTEGER DEFAULT 0,
    "cache_write_tokens" INTEGER DEFAULT 0,
    "cache_read_tokens" INTEGER DEFAULT 0
);

-- CreateTable
CREATE TABLE "dream_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dream" TEXT NOT NULL
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
    "lead_username" TEXT,
    "last_active" TEXT DEFAULT ''
);

-- CreateIndex
CREATE INDEX "idx_context_log_id_desc" ON "context_log"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_costs_id_desc" ON "costs"("id" DESC);

-- CreateIndex
CREATE INDEX "idx_dream_log_id_desc" ON "dream_log"("id" DESC);

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
