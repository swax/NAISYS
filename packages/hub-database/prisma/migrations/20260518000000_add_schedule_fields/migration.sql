ALTER TABLE "users" ADD COLUMN "next_run_at" DATETIME;
CREATE INDEX "idx_users_next_run_at" ON "users"("next_run_at");

ALTER TABLE "mail_messages" ADD COLUMN "source" TEXT;
CREATE INDEX "idx_mail_messages_source" ON "mail_messages"("source");

ALTER TABLE "run_session" ADD COLUMN "triggered_by" TEXT;
