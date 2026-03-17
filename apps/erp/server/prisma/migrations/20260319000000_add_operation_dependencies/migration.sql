-- CreateTable
CREATE TABLE "operation_dependencies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "successor_id" INTEGER NOT NULL,
    "predecessor_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    CONSTRAINT "operation_dependencies_successor_id_fkey" FOREIGN KEY ("successor_id") REFERENCES "operations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "operation_dependencies_predecessor_id_fkey" FOREIGN KEY ("predecessor_id") REFERENCES "operations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "operation_dependencies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "operation_dependencies_successor_id_predecessor_id_key" ON "operation_dependencies"("successor_id", "predecessor_id");

-- UpdateSchemaVersion
UPDATE "schema_version" SET "version" = 20, "updated" = datetime('now');
