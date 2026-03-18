-- Add multi_set flag to steps
ALTER TABLE "steps" ADD COLUMN "multi_set" BOOLEAN NOT NULL DEFAULT 0;

-- Add set_index to step_field_values
ALTER TABLE "step_field_values" ADD COLUMN "set_index" INTEGER NOT NULL DEFAULT 0;

-- Replace unique constraint to include set_index
DROP INDEX "step_field_values_step_run_id_step_field_id_key";
CREATE UNIQUE INDEX "step_field_values_step_run_id_step_field_id_set_index_key"
  ON "step_field_values" ("step_run_id", "step_field_id", "set_index");

-- Bump schema version
UPDATE "schema_version" SET "version" = 24, "updated" = datetime('now');
