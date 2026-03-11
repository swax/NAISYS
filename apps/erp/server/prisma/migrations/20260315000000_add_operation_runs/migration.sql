-- CreateTable
CREATE TABLE "operation_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "order_run_id" INTEGER NOT NULL,
    "operation_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completed_at" DATETIME,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "operation_runs_order_run_id_fkey" FOREIGN KEY ("order_run_id") REFERENCES "order_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "operation_runs_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "operation_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "operation_runs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "operation_runs_order_run_id_operation_id_key" ON "operation_runs"("order_run_id", "operation_id");
CREATE INDEX "operation_runs_status_idx" ON "operation_runs"("status");

-- UpdateSchemaVersion
UPDATE "schema_version" SET "version" = 14, "updated" = datetime('now');
