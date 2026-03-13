-- Drop the "name" column from the orders table.
ALTER TABLE "orders" DROP COLUMN "name";

-- Rename "notes" to "description" in order_revisions and make it non-nullable.
ALTER TABLE "order_revisions" RENAME COLUMN "notes" TO "description";
UPDATE "order_revisions" SET "description" = '' WHERE "description" IS NULL;

-- Drop the "released_at" column from the order_runs table.
ALTER TABLE "order_runs" DROP COLUMN "released_at";

-- Rename "notes" to "feedback" on operation_runs.
ALTER TABLE "operation_runs" RENAME COLUMN "notes" TO "feedback";
