PRAGMA foreign_keys=OFF;

-- 1. Create field_records table
CREATE TABLE "field_records" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "field_set_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    CONSTRAINT "field_records_field_set_id_fkey" FOREIGN KEY ("field_set_id") REFERENCES "field_sets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "field_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 2. Create field_values table
CREATE TABLE "field_values" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "field_record_id" INTEGER NOT NULL,
    "field_id" INTEGER NOT NULL,
    "set_index" INTEGER NOT NULL DEFAULT 0,
    "value" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "field_values_field_record_id_fkey" FOREIGN KEY ("field_record_id") REFERENCES "field_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "field_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "fields" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "field_values_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "field_values_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    UNIQUE ("field_record_id", "field_id", "set_index")
);

-- 3. Create field_attachments table
CREATE TABLE "field_attachments" (
    "field_value_id" INTEGER NOT NULL,
    "attachment_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "field_attachments_fv_fkey" FOREIGN KEY ("field_value_id") REFERENCES "field_values" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "field_attachments_att_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY ("field_value_id", "attachment_id")
);

-- 4. Add field_record_id to step_runs and item_instances
ALTER TABLE "step_runs" ADD COLUMN "field_record_id" INTEGER REFERENCES "field_records"("id");
ALTER TABLE "item_instances" ADD COLUMN "field_record_id" INTEGER REFERENCES "field_records"("id");

-- 5. Create field_records for step_runs that have field values (use step_run.id as field_record.id)
INSERT INTO "field_records" ("id", "field_set_id", "created_at", "created_by")
SELECT sr."id", s."field_set_id", sr."created_at", sr."created_by"
FROM "step_runs" sr
JOIN "steps" s ON sr."step_id" = s."id"
WHERE s."field_set_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "step_field_values" sfv WHERE sfv."step_run_id" = sr."id");

-- 6. Link step_runs to their field_records
UPDATE "step_runs" SET "field_record_id" = "id"
WHERE "id" IN (SELECT "id" FROM "field_records");

-- 7. Migrate field values (field_record_id = step_run_id, field_id = step_field_id)
INSERT OR IGNORE INTO "field_values" ("id", "field_record_id", "field_id", "set_index", "value", "created_at", "created_by", "updated_at", "updated_by")
SELECT sfv."id", sfv."step_run_id", sfv."step_field_id", sfv."set_index", sfv."value",
       sfv."created_at", sfv."created_by", sfv."updated_at", sfv."updated_by"
FROM "step_field_values" sfv
WHERE sfv."step_run_id" IN (SELECT "id" FROM "field_records");

-- 8. Migrate attachments
INSERT INTO "field_attachments" ("field_value_id", "attachment_id", "created_at")
SELECT sfa."step_field_value_id", sfa."attachment_id", sfa."created_at"
FROM "step_field_attachments" sfa
WHERE sfa."step_field_value_id" IN (SELECT "id" FROM "field_values");

-- 9. Drop old tables
DROP TABLE "step_field_attachments";
DROP TABLE "step_field_values";

PRAGMA foreign_keys=ON;

-- 10. Update schema version
INSERT OR REPLACE INTO "schema_version" ("id", "version", "updated") VALUES (1, 29, datetime('now'));
