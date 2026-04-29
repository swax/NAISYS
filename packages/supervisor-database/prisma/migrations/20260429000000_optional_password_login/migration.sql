-- Optional Supervisor password credential. Disabled by default at the server
-- layer; nullable so passkey-only users remain the default.
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
