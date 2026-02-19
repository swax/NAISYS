-- CreateTable
CREATE TABLE "plan_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "plan_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "plan_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plan_order_revs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plan_order_id" INTEGER NOT NULL,
    "rev_no" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "change_summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "plan_order_revs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "plan_order_revs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "plan_order_revs_plan_order_id_fkey" FOREIGN KEY ("plan_order_id") REFERENCES "plan_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "exec_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_no" INTEGER NOT NULL,
    "plan_order_id" INTEGER NOT NULL,
    "plan_order_rev_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'released',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "scheduled_start_at" DATETIME,
    "due_at" DATETIME,
    "released_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_to" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "exec_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exec_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exec_orders_plan_order_id_fkey" FOREIGN KEY ("plan_order_id") REFERENCES "plan_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "exec_orders_plan_order_rev_id_fkey" FOREIGN KEY ("plan_order_rev_id") REFERENCES "plan_order_revs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_agent" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "session_token_hash" TEXT,
    "session_expires_at" DATETIME
);

-- CreateTable
CREATE TABLE "schema_version" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "version" INTEGER NOT NULL,
    "updated" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "user_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_orders_key_key" ON "plan_orders"("key");

-- CreateIndex
CREATE INDEX "plan_orders_status_idx" ON "plan_orders"("status");

-- CreateIndex
CREATE INDEX "plan_orders_created_at_idx" ON "plan_orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_order_revs_plan_order_id_rev_no_key" ON "plan_order_revs"("plan_order_id", "rev_no");

-- CreateIndex
CREATE INDEX "exec_orders_status_idx" ON "exec_orders"("status");

-- CreateIndex
CREATE INDEX "exec_orders_priority_idx" ON "exec_orders"("priority");

-- CreateIndex
CREATE INDEX "exec_orders_created_at_idx" ON "exec_orders"("created_at");

-- CreateIndex
CREATE INDEX "exec_orders_plan_order_rev_id_idx" ON "exec_orders"("plan_order_rev_id");

-- CreateIndex
CREATE UNIQUE INDEX "exec_orders_plan_order_id_order_no_key" ON "exec_orders"("plan_order_id", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");
