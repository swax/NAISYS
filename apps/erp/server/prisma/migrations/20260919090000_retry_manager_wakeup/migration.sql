ALTER TABLE "operation_runs" ADD COLUMN "retry_manager_id" INTEGER REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operation_runs" ADD COLUMN "retry_wake_sent_at" DATETIME;
-- Existing deferred failures were recorded by an order manager.
UPDATE "operation_runs" SET "retry_manager_id" = "updated_by"
WHERE "status" = 'failed' AND "retry_not_before" IS NOT NULL;
