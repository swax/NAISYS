-- Rename table
ALTER TABLE "plan_order_revs" RENAME TO "order_revisions";

-- Recreate unique index with new table name
DROP INDEX "plan_order_revs_plan_order_id_rev_no_key";
CREATE UNIQUE INDEX "order_revisions_plan_order_id_rev_no_key" ON "order_revisions"("plan_order_id", "rev_no");

-- Rename FK column on order_runs
ALTER TABLE "order_runs" RENAME COLUMN "plan_order_rev_id" TO "order_rev_id";
DROP INDEX "order_runs_plan_order_rev_id_idx";
CREATE INDEX "order_runs_order_rev_id_idx" ON "order_runs"("order_rev_id");

-- Rename FK column on plan_operations
ALTER TABLE "plan_operations" RENAME COLUMN "plan_order_rev_id" TO "order_rev_id";
DROP INDEX "plan_operations_plan_order_rev_id_seq_no_key";
CREATE UNIQUE INDEX "plan_operations_order_rev_id_seq_no_key" ON "plan_operations"("order_rev_id", "seq_no");

-- Update audit entity type
UPDATE "audit_log" SET "entity_type" = 'OrderRevision' WHERE "entity_type" = 'PlanningOrderRevision';

-- Bump schema version
UPDATE "schema_version" SET "version" = 7, "updated" = datetime('now');
