-- Resumable scans: checkpoint the autonomous agent's LLM conversation so a
-- failed/paused scan can continue from where it stopped instead of restarting
-- (which re-burns the client's tokens). Idempotent.
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "agentState" jsonb;
