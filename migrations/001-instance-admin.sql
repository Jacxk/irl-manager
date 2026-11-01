BEGIN;
SELECT pg_advisory_xact_lock(839152001);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "instanceRole" text NOT NULL DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE media_server ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;
ALTER TABLE media_server ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS instance_setting (
  key text PRIMARY KEY, value jsonb, revision integer NOT NULL DEFAULT 1,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id text PRIMARY KEY, "actorId" text NOT NULL, target text NOT NULL,
  action text NOT NULL, "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limit (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL,
  "lastRequest" bigint NOT NULL
);
DO $$
DECLARE sole_id text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM instance_setting WHERE key = '_adminBootstrapCompleted') THEN
    IF (SELECT count(*) FROM "user") = 1 THEN
      SELECT id INTO sole_id FROM "user";
      UPDATE "user" SET "instanceRole" = 'admin' WHERE id = sole_id;
      INSERT INTO admin_audit (id, "actorId", target, action)
        VALUES ('initial-admin-bootstrap', sole_id, sole_id, 'bootstrap.admin');
    END IF;
    -- Never automatically promote accounts created after this migration.
    INSERT INTO instance_setting (key, value) VALUES ('_adminBootstrapCompleted', 'true');
  END IF;
END $$;
COMMIT;
