-- The user UUID is used as the WebAuthn user handle (opaque, stable, unique).
-- The schema previously allowed `uuid` to default to '' and didn't enforce
-- uniqueness, which made the user handle non-distinguishing for any rows that
-- slipped through with an empty value. Backfill any such rows with a fresh
-- v4-shaped UUID, then add the unique constraint.

UPDATE "users"
SET "uuid" = (
  lower(hex(randomblob(4)))
  || '-'
  || lower(hex(randomblob(2)))
  || '-4'
  || substr(lower(hex(randomblob(2))), 2)
  || '-'
  || substr('89ab', 1 + (abs(random()) % 4), 1)
  || substr(lower(hex(randomblob(2))), 2)
  || '-'
  || lower(hex(randomblob(6)))
)
WHERE "uuid" = '' OR "uuid" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_uuid_key" ON "users"("uuid");
