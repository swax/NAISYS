-- Add export_to_shell flag to variables (default false)
ALTER TABLE "variables" ADD COLUMN "export_to_shell" BOOLEAN NOT NULL DEFAULT 0;
