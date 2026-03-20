-- Remove scheduled_start_at, convert due_at from datetime to date string
ALTER TABLE "order_runs" DROP COLUMN "scheduled_start_at";

-- SQLite doesn't support ALTER COLUMN, so we keep due_at as-is (TEXT is already the storage type).
-- Existing datetime values will still work as date strings since date comparisons sort lexicographically.
