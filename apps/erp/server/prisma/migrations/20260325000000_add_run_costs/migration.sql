-- Add cost column to operation_runs and order_runs
ALTER TABLE "operation_runs" ADD COLUMN "cost" REAL;
ALTER TABLE "order_runs" ADD COLUMN "cost" REAL;
