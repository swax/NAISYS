-- CreateTable
CREATE TABLE "step_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operation_run_id" INTEGER NOT NULL,
    "step_id" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "step_runs_operation_run_id_fkey" FOREIGN KEY ("operation_run_id") REFERENCES "operation_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_runs_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "steps" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_runs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "step_runs_operation_run_id_step_id_key" ON "step_runs"("operation_run_id", "step_id");

-- CreateTable
CREATE TABLE "step_field_values" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "step_run_id" INTEGER NOT NULL,
    "step_field_id" INTEGER NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "step_field_values_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_field_values_step_field_id_fkey" FOREIGN KEY ("step_field_id") REFERENCES "step_fields" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_field_values_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_field_values_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "step_field_values_step_run_id_step_field_id_key" ON "step_field_values"("step_run_id", "step_field_id");

-- UpdateSchemaVersion
UPDATE "schema_version" SET "version" = 15, "updated" = datetime('now');
