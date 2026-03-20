-- Add title column to steps
ALTER TABLE "steps" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
