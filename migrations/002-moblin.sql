BEGIN;
SELECT pg_advisory_xact_lock(839152003);
CREATE TABLE IF NOT EXISTS moblin_pairing (
  "channelId" text PRIMARY KEY REFERENCES channel(id) ON DELETE CASCADE,
  "workspaceId" text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  "pairedBy" text REFERENCES "user"(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT false,
  "syncBroadcast" boolean NOT NULL DEFAULT false,
  "encryptedPassword" text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  "lowBitrateKbps" integer NOT NULL DEFAULT 500,
  "lowBitrateSeconds" integer NOT NULL DEFAULT 5,
  "recoverySeconds" integer NOT NULL DEFAULT 5,
  "connectionId" text,
  "lastSeenAt" timestamp,
  "lastStreaming" boolean,
  "bitrateKbps" integer,
  "bitrateAt" timestamp,
  "lowSince" timestamp,
  "healthySince" timestamp,
  "lowBitrateActive" boolean NOT NULL DEFAULT false,
  "lastError" text
);
COMMIT;
