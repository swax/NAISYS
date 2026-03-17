-- AlterTable: add is_array column
ALTER TABLE "step_fields" ADD COLUMN "is_array" BOOLEAN NOT NULL DEFAULT 0;

-- Migrate existing StringArray fields to string + is_array
UPDATE "step_fields" SET "type" = 'string', "is_array" = 1 WHERE "type" = 'StringArray';
