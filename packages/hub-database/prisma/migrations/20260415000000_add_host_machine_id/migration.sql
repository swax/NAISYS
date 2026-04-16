ALTER TABLE "hosts" ADD COLUMN "machine_id" TEXT;
CREATE UNIQUE INDEX "unq_hosts_machine_id" ON "hosts"("machine_id");
