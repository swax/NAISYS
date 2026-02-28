-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_hosts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "host_type" TEXT NOT NULL DEFAULT 'naisys',
    "last_active" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_hosts" ("created_at", "id", "last_active", "name", "restricted") SELECT "created_at", "id", "last_active", "name", "restricted" FROM "hosts";
DROP TABLE "hosts";
ALTER TABLE "new_hosts" RENAME TO "hosts";
CREATE UNIQUE INDEX "unq_hosts_name" ON "hosts"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Update schema version
INSERT INTO "schema_version" ("id", "version", "updated") VALUES (1, 21, datetime('now'))
ON CONFLICT ("id") DO UPDATE SET "version" = 21, "updated" = datetime('now');
