ALTER TABLE "mail_recipients" ADD COLUMN "read_run_id" INTEGER;

-- Backfill: for each read row, pick the user's most recent run_session created
-- on or before read_at. Best-effort — rows predating any run_session stay NULL.
UPDATE "mail_recipients"
SET "read_run_id" = (
  SELECT MAX(rs."run_id")
  FROM "run_session" rs
  WHERE rs."user_id" = "mail_recipients"."user_id"
    AND rs."created_at" <= "mail_recipients"."read_at"
)
WHERE "read_at" IS NOT NULL;

