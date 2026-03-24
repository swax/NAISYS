-- CreateTable: operation_field_refs
CREATE TABLE "operation_field_refs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operation_id" INTEGER NOT NULL,
    "seq_no" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "source_step_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    CONSTRAINT "operation_field_refs_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "operations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "operation_field_refs_source_step_id_fkey" FOREIGN KEY ("source_step_id") REFERENCES "steps" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "operation_field_refs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "operation_field_refs_operation_id_seq_no_key" ON "operation_field_refs"("operation_id", "seq_no");
CREATE UNIQUE INDEX "operation_field_refs_operation_id_source_step_id_key" ON "operation_field_refs"("operation_id", "source_step_id");
