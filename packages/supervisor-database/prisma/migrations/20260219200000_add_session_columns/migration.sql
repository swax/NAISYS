-- AlterTable
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN "session_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "session_expires_at" DATETIME;
