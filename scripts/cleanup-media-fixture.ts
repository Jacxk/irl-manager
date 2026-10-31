import 'dotenv/config';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { workspace, user } from '../src/lib/db/schema';
const path = '/tmp/irl-manager-fixture.json';
const fixture = JSON.parse(readFileSync(path, 'utf8'));
try {
  await db.delete(workspace).where(inArray(workspace.id, fixture.workspaces));
  for (const account of [fixture.owner, fixture.outsider])
    await db.delete(user).where(eq(user.id, account.id));
  const env = readFileSync('.env', 'utf8');
  if (env.match(/^MEDIA_SERVER_ID=(.*)$/m)?.[1] === fixture.server.id)
    writeFileSync(
      '.env',
      env.replace(/^MEDIA_SERVER_ID=.*$/m, `MEDIA_SERVER_ID=${fixture.previousServerId ?? ''}`),
      { mode: 0o600 },
    );
  unlinkSync(path);
  console.log('Removed disposable fixture accounts, workspaces, and local credentials.');
} finally {
  await sql.end();
}
