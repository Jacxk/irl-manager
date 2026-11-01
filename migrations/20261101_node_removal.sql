-- Additive migration: preserve existing node settings and application data.
ALTER TABLE "media_server" ADD COLUMN IF NOT EXISTS "removalRequestedAt" timestamp;
ALTER TABLE "node_installation" ADD COLUMN IF NOT EXISTS "operation" text NOT NULL DEFAULT 'install';
ALTER TABLE "node_installation" ADD COLUMN IF NOT EXISTS "removalVerifiedAt" timestamp;
ALTER TABLE "node_installation" ADD COLUMN IF NOT EXISTS "remoteRemovedAt" timestamp;
