-- Rename plan_orders table
ALTER TABLE "plan_orders" RENAME TO "orders";

-- Recreate indexes with new table name
DROP INDEX "plan_orders_key_key";
CREATE UNIQUE INDEX "orders_key_key" ON "orders"("key");
DROP INDEX "plan_orders_status_idx";
CREATE INDEX "orders_status_idx" ON "orders"("status");
DROP INDEX "plan_orders_created_at_idx";
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- Rename FK column on order_revisions
ALTER TABLE "order_revisions" RENAME COLUMN "plan_order_id" TO "order_id";
DROP INDEX "order_revisions_plan_order_id_rev_no_key";
CREATE UNIQUE INDEX "order_revisions_order_id_rev_no_key" ON "order_revisions"("order_id", "rev_no");

-- Rename FK column on order_runs
ALTER TABLE "order_runs" RENAME COLUMN "plan_order_id" TO "order_id";
DROP INDEX "order_runs_plan_order_id_order_no_key";
CREATE UNIQUE INDEX "order_runs_order_id_order_no_key" ON "order_runs"("order_id", "order_no");

-- Bump schema version
UPDATE "schema_version" SET "version" = 8, "updated" = datetime('now');
