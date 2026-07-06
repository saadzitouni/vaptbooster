-- Store the tenant's LiteLLM virtual key so it can be provisioned from the
-- operator UI and read by the worker + autonomous runner (both have DB access),
-- instead of relying on the .secrets/litellm-keys.json bridge file.
-- Idempotent.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "litellmKey" TEXT;
