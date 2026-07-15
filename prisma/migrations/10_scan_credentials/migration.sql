-- Authenticated / gray-box scanning: an optional encrypted (AES-256-GCM) blob
-- of test credentials the agent uses to log in. Nullable, idempotent.
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "credentials" TEXT;
