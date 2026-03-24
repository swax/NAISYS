-- Rename completion_note → status_note on operation_runs
ALTER TABLE "operation_runs" RENAME COLUMN "completion_note" TO "status_note";

-- Rename completion_note → status_note on step_runs
ALTER TABLE "step_runs" RENAME COLUMN "completion_note" TO "status_note";
