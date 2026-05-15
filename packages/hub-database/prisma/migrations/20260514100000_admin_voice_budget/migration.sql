-- Make the admin agent's spend limit usable as a real cap for the voice
-- agent feature. seedAgentConfigs (apps/hub/src/services/agentRegistrar.ts)
-- only seeds users into an empty database, so the code-side bump to
-- adminAgentConfig in packages/common/src/agentConfigFile.ts never reaches
-- deployed databases — they keep the legacy "spendLimitDollars: 1, no
-- spendLimitHours" config, which is a fixed all-time cap that would
-- permanently suspend the admin user once voice usage exceeded it.
--
-- Patch surgically so we don't clobber operator tuning:
--   * Set spendLimitHours to 24 only when it isn't already set (the legacy
--     config had no rolling window at all).
--   * Bump spendLimitDollars from the literal legacy default 1 to 25; leave
--     any other operator-chosen value alone.

UPDATE users
SET config = json_set(config, '$.spendLimitHours', 24)
WHERE username = 'admin'
  AND json_extract(config, '$.spendLimitHours') IS NULL;

UPDATE users
SET config = json_set(config, '$.spendLimitDollars', 25)
WHERE username = 'admin'
  AND json_extract(config, '$.spendLimitDollars') = 1;
