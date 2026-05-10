-- Move attachment cleanup to a periodic GC: uploaded_by becomes nullable +
-- SET NULL, and the link FKs (mail_attachments, user_startup_attachments)
-- become CASCADE so the GC can drop a row without per-caller link cleanup.

PRAGMA foreign_keys=OFF;

-- attachments: uploaded_by nullable + SET NULL
CREATE TABLE "new_attachments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "public_id" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "uploaded_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_attachments" (
    "id",
    "public_id",
    "filepath",
    "filename",
    "file_size",
    "file_hash",
    "purpose",
    "uploaded_by",
    "created_at"
)
SELECT
    "id",
    "public_id",
    "filepath",
    "filename",
    "file_size",
    "file_hash",
    "purpose",
    "uploaded_by",
    "created_at"
FROM "attachments";

DROP TABLE "attachments";
ALTER TABLE "new_attachments" RENAME TO "attachments";

CREATE UNIQUE INDEX "attachments_public_id_key" ON "attachments"("public_id");

-- mail_attachments: attachment_id → CASCADE
CREATE TABLE "new_mail_attachments" (
    "message_id" INTEGER NOT NULL,
    "attachment_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("message_id", "attachment_id"),
    CONSTRAINT "mail_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "mail_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

INSERT INTO "new_mail_attachments" ("message_id", "attachment_id", "created_at")
SELECT "message_id", "attachment_id", "created_at" FROM "mail_attachments";

DROP TABLE "mail_attachments";
ALTER TABLE "new_mail_attachments" RENAME TO "mail_attachments";

-- user_startup_attachments: attachment_id → CASCADE
CREATE TABLE "new_user_startup_attachments" (
    "user_id" INTEGER NOT NULL,
    "attachment_id" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("user_id", "path"),
    CONSTRAINT "user_startup_attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "user_startup_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

INSERT INTO "new_user_startup_attachments" ("user_id", "attachment_id", "path", "created_at")
SELECT "user_id", "attachment_id", "path", "created_at" FROM "user_startup_attachments";

DROP TABLE "user_startup_attachments";
ALTER TABLE "new_user_startup_attachments" RENAME TO "user_startup_attachments";

CREATE INDEX "idx_user_startup_attachments_attachment_id" ON "user_startup_attachments"("attachment_id");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
