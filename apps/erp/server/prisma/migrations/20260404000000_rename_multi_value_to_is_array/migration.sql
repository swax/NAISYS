-- Rename multi_value column back to is_array
ALTER TABLE "fields" RENAME COLUMN "multi_value" TO "is_array";
