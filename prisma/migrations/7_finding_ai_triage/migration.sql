-- AI triage assistant output, cached on the finding (verdict, confidence,
-- severity assessment, how-to-confirm, remediation, recommended action) so the
-- operator console doesn't re-bill an LLM call on every render. Idempotent.
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "aiTriage" jsonb;
