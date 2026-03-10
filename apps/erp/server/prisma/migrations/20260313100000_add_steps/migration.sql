-- CreateTable
CREATE TABLE "steps" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operation_id" INTEGER NOT NULL,
    "seq_no" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "steps_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "steps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "steps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "steps_operation_id_seq_no_key" ON "steps"("operation_id", "seq_no");

-- UpdateSchemaVersion
UPDATE "schema_version" SET "version" = 12, "updated" = datetime('now');
