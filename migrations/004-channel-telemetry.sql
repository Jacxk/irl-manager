BEGIN;
SELECT pg_advisory_xact_lock(839152004);
ALTER TABLE channel ADD COLUMN IF NOT EXISTS "lastFrameAt" timestamp;
ALTER TABLE channel ADD COLUMN IF NOT EXISTS "receiveKbps" integer;
ALTER TABLE channel ADD COLUMN IF NOT EXISTS "sendKbps" integer;
ALTER TABLE channel ADD COLUMN IF NOT EXISTS "telemetryAt" timestamp;
COMMIT;
