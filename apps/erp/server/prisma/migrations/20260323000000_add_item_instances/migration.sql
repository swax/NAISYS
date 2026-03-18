CREATE TABLE "item_instances" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "item_id" INTEGER NOT NULL,
    "order_run_id" INTEGER,
    "key" TEXT NOT NULL,
    "quantity" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "item_instances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "item_instances_order_run_id_fkey" FOREIGN KEY ("order_run_id") REFERENCES "order_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "item_instances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "item_instances_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "item_instances_item_id_key_key" ON "item_instances"("item_id", "key");
CREATE INDEX "item_instances_order_run_id_idx" ON "item_instances"("order_run_id");
