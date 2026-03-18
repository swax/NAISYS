-- Create attachments table
CREATE TABLE "attachments" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "filepath" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "file_hash" TEXT NOT NULL,
  "uploaded_by" INTEGER NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "attachments_file_hash_idx" ON "attachments" ("file_hash");

-- Create step_field_attachments junction table
CREATE TABLE "step_field_attachments" (
  "step_field_value_id" INTEGER NOT NULL,
  "attachment_id" INTEGER NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "step_field_attachments_step_field_value_id_fkey" FOREIGN KEY ("step_field_value_id") REFERENCES "step_field_values" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "step_field_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("step_field_value_id", "attachment_id")
);

-- No DDL needed for new StepFieldType value 'attachment': SQLite stores enums as TEXT.

-- Bump schema version
UPDATE "schema_version" SET "version" = 26, "updated" = datetime('now');
