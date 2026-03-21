-- CreateTable: work_centers
CREATE TABLE "work_centers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" INTEGER NOT NULL,
    CONSTRAINT "work_centers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "work_centers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "work_centers_key_key" ON "work_centers"("key");
CREATE INDEX "work_centers_created_at_idx" ON "work_centers"("created_at");

-- CreateTable: work_center_users
CREATE TABLE "work_center_users" (
    "work_center_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER NOT NULL,
    CONSTRAINT "work_center_users_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "work_center_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "work_center_users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY ("work_center_id", "user_id")
);

-- AlterTable: add work_center_id to operations
ALTER TABLE "operations" ADD COLUMN "work_center_id" INTEGER REFERENCES "work_centers"("id") ON DELETE SET NULL;
