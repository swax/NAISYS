-- Per-host access keys: each host has its own SHA-256-hashed access key.
-- The plaintext lives in the client's HOST_ACCESS_KEY env var; only the hash
-- is stored here. Existing rows get NULL and must be re-keyed via the
-- supervisor UI before they can authenticate.
ALTER TABLE "hosts" ADD COLUMN "access_key_hash" TEXT;
CREATE UNIQUE INDEX "unq_hosts_access_key_hash" ON "hosts"("access_key_hash");

-- machine_id was used to dedupe reconnecting clients. The access key now
-- serves as the durable identity, so the column and its unique index are
-- no longer needed.
DROP INDEX "unq_hosts_machine_id";
ALTER TABLE "hosts" DROP COLUMN "machine_id";
