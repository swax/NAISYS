-- Add item_id column to orders
ALTER TABLE "orders" ADD COLUMN "item_id" INTEGER REFERENCES "items"("id") ON DELETE RESTRICT;

-- CreateIndex
CREATE INDEX "orders_item_id_idx" ON "orders"("item_id");

-- UpdateSchemaVersion
UPDATE "schema_version" SET "version" = 18, "updated" = datetime('now');
