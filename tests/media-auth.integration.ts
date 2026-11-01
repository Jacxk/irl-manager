import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_admin_verify'));
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const f = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const id = randomUUID(),
  key = randomUUID();
async function auth(body: unknown, expected: number) {
  const r = await fetch(base + '/api/media/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, expected);
}
try {
  await sql`insert into channel(id,"workspaceId","serverId",name,protocol,"ingestKey") values(${id},${f.workspaces[0]},${f.server.id},'Auth fixture','srt',${key})`;
  await auth({ action: 'publish', path: `input_${id}`, user: id, password: key }, 200);
  for (const body of [
    null,
    {},
    { action: 'read', path: `input_${id}`, user: id, password: key },
    { action: 'publish', path: `program_${id}`, user: id, password: key },
    { action: 'publish', path: `input_${id}`, user: id, password: 'incorrect' },
    { action: 'publish', path: `input_${id}`, user: randomUUID(), password: key },
  ])
    await auth(body, 401);
  assert.ok(process.env.MEDIA_WORKER_TOKEN);
  await auth(
    {
      action: 'read',
      path: `program_${id}`,
      user: 'worker',
      password: process.env.MEDIA_WORKER_TOKEN,
    },
    200,
  );
  await auth({ action: 'read', path: `program_${id}`, user: 'worker', password: 'wrong' }, 401);
  const malformed = await fetch(base + '/api/media/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 401);
  console.log(
    'PASS legacy media auth allows publisher scope and worker credentials; rejects reads, wrong paths/keys/users and malformed bodies',
  );
} finally {
  await sql`delete from channel where id=${id}`;
  await sql.end();
}
