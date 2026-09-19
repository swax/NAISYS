ALTER TABLE "operation_runs" ADD COLUMN "retry_not_before" DATETIME;
CREATE INDEX "operation_runs_retry_not_before_idx" ON "operation_runs"("retry_not_before");
