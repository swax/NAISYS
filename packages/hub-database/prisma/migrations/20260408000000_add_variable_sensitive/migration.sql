-- Add sensitive flag to variables (default false)
ALTER TABLE "variables" ADD COLUMN "sensitive" BOOLEAN NOT NULL DEFAULT 0;
