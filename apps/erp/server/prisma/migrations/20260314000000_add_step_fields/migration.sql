-- CreateTable
CREATE TABLE "step_fields" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "step_id" INTEGER NOT NULL,
    "seq_no" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'string',
    "required" BOOLEAN NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "step_fields_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "steps" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "step_fields_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_fields_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "step_fields_step_id_seq_no_key" ON "step_fields"("step_id", "seq_no");

-- UpdateSchemaVersion
UPDATE "schema_version" SET "version" = 13, "updated" = datetime('now');
