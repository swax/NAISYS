-- CreateTable
CREATE TABLE "plan_operations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "plan_order_rev_id" INTEGER NOT NULL,
    "seq_no" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "plan_operations_plan_order_rev_id_fkey" FOREIGN KEY ("plan_order_rev_id") REFERENCES "plan_order_revs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "plan_operations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "plan_operations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_operations_plan_order_rev_id_seq_no_key" ON "plan_operations"("plan_order_rev_id", "seq_no");

-- UpdateVersion
UPDATE "schema_version" SET "version" = 5, "updated" = datetime('now');
