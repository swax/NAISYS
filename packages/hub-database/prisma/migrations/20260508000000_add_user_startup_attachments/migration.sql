-- CreateTable
CREATE TABLE "user_startup_attachments" (
    "user_id" INTEGER NOT NULL,
    "attachment_id" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("user_id", "path"),
    CONSTRAINT "user_startup_attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "user_startup_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateIndex
CREATE INDEX "idx_user_startup_attachments_attachment_id" ON "user_startup_attachments"("attachment_id");
