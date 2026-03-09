ALTER TABLE "order_runs" RENAME COLUMN "order_no" TO "run_no";
DROP INDEX "order_runs_order_id_order_no_key";
CREATE UNIQUE INDEX "order_runs_order_id_run_no_key" ON "order_runs"("order_id", "run_no");
