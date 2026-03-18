PRAGMA foreign_keys=OFF;

-- 1. Create field_sets table
CREATE TABLE "field_sets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    CONSTRAINT "field_sets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 2. Add field_set_id to steps and items
ALTER TABLE "steps" ADD COLUMN "field_set_id" INTEGER REFERENCES "field_sets"("id");
ALTER TABLE "items" ADD COLUMN "field_set_id" INTEGER REFERENCES "field_sets"("id");

-- 3. Create a field_set for each step that has fields (using step.id as field_set.id)
INSERT INTO "field_sets" ("id", "created_at", "created_by")
SELECT DISTINCT s."id", s."created_at", s."created_by"
FROM "steps" s
WHERE EXISTS (SELECT 1 FROM "step_fields" sf WHERE sf."step_id" = s."id");

-- 4. Link steps to their field_sets
UPDATE "steps" SET "field_set_id" = "id"
WHERE "id" IN (SELECT "id" FROM "field_sets");

-- 5. Create new fields table
CREATE TABLE "fields" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "field_set_id" INTEGER NOT NULL,
    "seq_no" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'string',
    "multi_value" BOOLEAN NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "fields_field_set_id_fkey" FOREIGN KEY ("field_set_id") REFERENCES "field_sets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fields_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fields_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fields_field_set_id_seq_no_key" ON "fields"("field_set_id", "seq_no");

-- 6. Copy data from step_fields to fields (step_id = field_set_id since IDs match)
INSERT INTO "fields" ("id", "field_set_id", "seq_no", "label", "type", "multi_value", "required", "created_at", "created_by", "updated_at", "updated_by")
SELECT "id", "step_id", "seq_no", "label", "type", "multi_value", "required", "created_at", "created_by", "updated_at", "updated_by"
FROM "step_fields";

-- 7. Recreate step_field_values with FK to fields instead of step_fields
CREATE TABLE "step_field_values_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "step_run_id" INTEGER NOT NULL,
    "step_field_id" INTEGER NOT NULL,
    "set_index" INTEGER NOT NULL DEFAULT 0,
    "value" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "step_field_values_step_run_id_fkey" FOREIGN KEY ("step_run_id") REFERENCES "step_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_field_values_step_field_id_fkey" FOREIGN KEY ("step_field_id") REFERENCES "fields" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_field_values_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "step_field_values_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE ("step_run_id", "step_field_id", "set_index")
);
INSERT OR IGNORE INTO "step_field_values_new" SELECT * FROM "step_field_values";

-- 8. Recreate step_field_attachments (references step_field_values by final name)
CREATE TABLE "step_field_attachments_new" (
    "step_field_value_id" INTEGER NOT NULL,
    "attachment_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "step_field_attachments_sfv_fkey" FOREIGN KEY ("step_field_value_id") REFERENCES "step_field_values" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "step_field_attachments_att_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY ("step_field_value_id", "attachment_id")
);
INSERT INTO "step_field_attachments_new" SELECT * FROM "step_field_attachments";

-- 9. Drop old tables and rename new ones
DROP TABLE "step_field_attachments";
DROP TABLE "step_field_values";
DROP TABLE "step_fields";

ALTER TABLE "step_field_values_new" RENAME TO "step_field_values";
ALTER TABLE "step_field_attachments_new" RENAME TO "step_field_attachments";

PRAGMA foreign_keys=ON;

-- 11. Update schema version
INSERT OR REPLACE INTO "schema_version" ("id", "version", "updated") VALUES (1, 27, datetime('now'));
