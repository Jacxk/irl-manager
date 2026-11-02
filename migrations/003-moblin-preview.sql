BEGIN;
SELECT pg_advisory_xact_lock(839152003);
ALTER TABLE moblin_pairing ADD COLUMN IF NOT EXISTS "previewSessionId" text;
ALTER TABLE moblin_pairing ADD COLUMN IF NOT EXISTS "previewStartedAt" timestamp;
ALTER TABLE moblin_pairing ADD COLUMN IF NOT EXISTS "previewState" text NOT NULL DEFAULT 'idle';
ALTER TABLE moblin_pairing ADD COLUMN IF NOT EXISTS "previewLastFrameAt" timestamp;
ALTER TABLE moblin_pairing ADD COLUMN IF NOT EXISTS "previewUpdatedAt" timestamp;
COMMIT;
