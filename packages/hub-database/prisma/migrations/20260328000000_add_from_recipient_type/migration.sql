-- SQLite has no enum types; Prisma stores RecipientType as text.
-- No ALTER TYPE needed — 'from' is valid as soon as it's inserted.

-- Backfill: add 'from' recipient records for all existing messages
-- where the sender doesn't already have a recipient record.
-- Sets read_at = created_at since the sender has already "read" their own message.
INSERT INTO mail_recipients (message_id, user_id, type, read_at, created_at)
SELECT m.id, m.from_user_id, 'from', m.created_at, m.created_at
FROM mail_messages m
WHERE NOT EXISTS (
  SELECT 1 FROM mail_recipients r
  WHERE r.message_id = m.id AND r.user_id = m.from_user_id
);
