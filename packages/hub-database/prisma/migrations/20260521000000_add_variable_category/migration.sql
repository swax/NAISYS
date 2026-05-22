-- Add the nullable category column.
ALTER TABLE "variables" ADD COLUMN "category" TEXT;

-- Backfill default categories for variables NAISYS knows about. Keep in sync
-- with defaultCategoryForVariable in packages/common/src/config/knownVariables.ts.
UPDATE "variables" SET "category" = 'API Keys'
WHERE "category" IS NULL AND "key" IN (
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY',
  'GOOGLE_SEARCH_ENGINE_ID', 'XAI_API_KEY', 'CODEX_REFRESH_TOKEN',
  'OPENROUTER_API_KEY'
);

UPDATE "variables" SET "category" = 'System'
WHERE "category" IS NULL AND "key" IN (
  'TIMEZONE', 'TARGET_VERSION', 'MAIL_ENABLED', 'VOICE_AGENT_MODEL'
);

UPDATE "variables" SET "category" = 'Spend Limits'
WHERE "category" IS NULL AND "key" IN (
  'SPEND_LIMIT_DOLLARS', 'SPEND_LIMIT_HOURS',
  'CODEX_USAGE_LIMIT_PERCENT', 'CODEX_USAGE_CHECK_MINUTES'
);
