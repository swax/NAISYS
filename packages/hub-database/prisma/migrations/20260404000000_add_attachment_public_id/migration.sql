-- Add public_id column to attachments (nullable initially for migration)
ALTER TABLE "attachments" ADD COLUMN "public_id" TEXT;

-- Populate existing rows with 12-char random hex
UPDATE "attachments" SET "public_id" = lower(hex(randomblob(6)));

-- Make non-nullable and add unique index
CREATE UNIQUE INDEX "attachments_public_id_key" ON "attachments"("public_id");
