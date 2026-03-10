-- Step 1: Add participants column
ALTER TABLE "mail_messages" ADD COLUMN "participants" TEXT NOT NULL DEFAULT '';

-- Step 2: Backfill using recursive CTE (split participant_ids CSV into rows,
-- join to users for usernames, GROUP_CONCAT back into sorted CSV)
WITH RECURSIVE split(msg_id, pid_str, participant_id, rest) AS (
  SELECT id, participant_ids,
    CAST(CASE WHEN INSTR(participant_ids, ',') > 0
         THEN SUBSTR(participant_ids, 1, INSTR(participant_ids, ',') - 1)
         ELSE participant_ids END AS INTEGER),
    CASE WHEN INSTR(participant_ids, ',') > 0
         THEN SUBSTR(participant_ids, INSTR(participant_ids, ',') + 1)
         ELSE '' END
  FROM mail_messages WHERE participant_ids != ''
  UNION ALL
  SELECT msg_id, pid_str,
    CAST(CASE WHEN INSTR(rest, ',') > 0
         THEN SUBSTR(rest, 1, INSTR(rest, ',') - 1)
         ELSE rest END AS INTEGER),
    CASE WHEN INSTR(rest, ',') > 0
         THEN SUBSTR(rest, INSTR(rest, ',') + 1)
         ELSE '' END
  FROM split WHERE rest != ''
),
resolved AS (
  SELECT s.msg_id, s.pid_str, u.username
  FROM split s JOIN users u ON u.id = s.participant_id
),
grouped AS (
  SELECT pid_str, GROUP_CONCAT(username, ',') AS participants
  FROM (SELECT DISTINCT pid_str, username FROM resolved ORDER BY pid_str, username)
  GROUP BY pid_str
)
UPDATE mail_messages SET participants = (
  SELECT g.participants FROM grouped g WHERE g.pid_str = mail_messages.participant_ids
) WHERE participant_ids != '';

-- Step 3: Redefine table without participant_ids
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_mail_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "from_user_id" INTEGER NOT NULL,
    "host_id" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'mail',
    "participants" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_messages_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "mail_messages_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_mail_messages" ("id", "from_user_id", "host_id", "kind", "participants", "subject", "body", "created_at")
    SELECT "id", "from_user_id", "host_id", "kind", "participants", "subject", "body", "created_at" FROM "mail_messages";
DROP TABLE "mail_messages";
ALTER TABLE "new_mail_messages" RENAME TO "mail_messages";
CREATE INDEX "idx_mail_messages_from_user_id" ON "mail_messages"("from_user_id");
CREATE INDEX "idx_mail_messages_created_at_desc" ON "mail_messages"("created_at" DESC);
CREATE INDEX "idx_mail_messages_participants" ON "mail_messages"("participants");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
