-- CreateTable
CREATE TABLE "labor_tickets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operation_run_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "run_id" INTEGER,
    "clock_in" DATETIME NOT NULL,
    "clock_out" DATETIME,
    "cost" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "labor_tickets_operation_run_id_fkey" FOREIGN KEY ("operation_run_id") REFERENCES "operation_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "labor_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "labor_tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "labor_tickets_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "labor_tickets_operation_run_id_idx" ON "labor_tickets"("operation_run_id");

-- CreateIndex
CREATE INDEX "labor_tickets_user_id_clock_out_idx" ON "labor_tickets"("user_id", "clock_out");

-- UpdateSchemaVersion
UPDATE "schema_version" SET "version" = 19, "updated" = datetime('now');
