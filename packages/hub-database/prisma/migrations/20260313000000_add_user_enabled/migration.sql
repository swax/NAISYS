-- AlterTable
ALTER TABLE "users" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

-- Migrate: disable archived users
UPDATE "users" SET "enabled" = false WHERE "archived" = true;
