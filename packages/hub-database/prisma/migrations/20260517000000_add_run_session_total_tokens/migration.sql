ALTER TABLE "run_session" ADD COLUMN "total_tokens" INTEGER NOT NULL DEFAULT 0;

-- Backfill from `costs`: the agent's main loop writes source='console' rows
-- per LLM call, so the latest one per session reconstructs the final context
-- size. The sum mirrors how every vendor derives messagesTokenCount.

UPDATE "run_session"
SET "total_tokens" = COALESCE((
  SELECT COALESCE("input_tokens", 0)
       + COALESCE("cache_write_tokens", 0)
       + COALESCE("cache_read_tokens", 0)
  FROM "costs"
  WHERE "costs"."user_id"     = "run_session"."user_id"
    AND "costs"."run_id"      = "run_session"."run_id"
    AND "costs"."subagent_id" = "run_session"."subagent_id"
    AND "costs"."session_id"  = "run_session"."session_id"
    AND "costs"."source"      = 'console'
  ORDER BY "costs"."id" DESC
  LIMIT 1
), 0);
