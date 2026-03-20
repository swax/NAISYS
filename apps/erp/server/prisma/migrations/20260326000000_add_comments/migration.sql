-- Add operation_run_comments table and remove unused feedback column from operation_runs
CREATE TABLE "operation_run_comments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operation_run_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'note',
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    CONSTRAINT "operation_run_comments_operation_run_id_fkey" FOREIGN KEY ("operation_run_id") REFERENCES "operation_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "operation_run_comments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "operation_run_comments_operation_run_id_idx" ON "operation_run_comments"("operation_run_id");

-- Remove unused feedback column
ALTER TABLE "operation_runs" DROP COLUMN "feedback";
