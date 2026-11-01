import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
const database = process.env.DATABASE_URL!;
assert.ok(new URL(database).pathname.endsWith('_admin_verify'), 'Use disposable audit database');
const sql = postgres(database, { max: 4 });
const ids: string[] = [];
const spaces: string[] = [];
async function account() {
  // This disposable-database suite tests locking, not authentication throttling.
  await sql`delete from rate_limit`;
  const res = await fetch(base + '/api/auth/sign-up/email', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Race fixture',
      email: `${randomUUID()}@example.test`,
      password: randomUUID(),
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  ids.push(body.user.id);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const state = await (await fetch(base + '/api/control', { headers: { Cookie: cookie } })).json();
  spaces.push(state.workspace.id);
  return { cookie, id: body.user.id, workspaceId: state.workspace.id };
}
function command(cookie: string, body: unknown) {
  return fetch(base + '/api/control', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Expected database synchronization point was not reached');
}
try {
  for (const [scenario, change] of [
    ['manual', 'status'],
    ['wizard', 'status'],
    ['manual', 'role'],
    ['wizard', 'role'],
  ] as const) {
    const owner = await account();
    if (change === 'role') await sql`update "user" set "instanceRole"='admin' where id=${owner.id}`;
    const blocker = await sql.reserve();
    let mutation: Promise<Response> | undefined;
    try {
      await blocker`begin`;
      await blocker`select id from member where "userId"=${owner.id} for update`;
      mutation =
        scenario === 'manual'
          ? command(owner.cookie, {
              action: 'createServer',
              name: 'Deactivation race',
              host: 'localhost',
              region: 'Test',
            })
          : fetch(base + '/api/nodes/installations', {
              method: 'POST',
              headers: { Cookie: owner.cookie, Origin: base, 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'ssh' }),
            });
      await until(
        async () =>
          (
            await sql`select 1 from pg_stat_activity where wait_event_type='Lock' and query ilike '%member%for update%'`
          ).length > 0,
      );
      if (change === 'status') await sql`update "user" set active=false where id=${owner.id}`;
      else await sql`update "user" set "instanceRole"='user' where id=${owner.id}`;
    } finally {
      await blocker`rollback`;
      blocker.release();
    }
    const result = await mutation!;
    assert.equal(
      result.status,
      change === 'status' ? 403 : 409,
      `Deactivated account completed ${scenario} mutation`,
    );
    assert.equal(
      (await sql`select id from media_server where "workspaceId"=${owner.workspaceId}`).length,
      0,
    );
    console.log(`PASS ${change} change rejects waiting ${scenario} mutation`);
  }
  const inFlight = await account();
  const quotaBlock = await sql.reserve();
  let creation: Promise<Response> | undefined;
  let deactivate: Promise<unknown> | undefined;
  try {
    await quotaBlock`select pg_advisory_lock(hashtext(${inFlight.workspaceId}))`;
    creation = command(inFlight.cookie, {
      action: 'createServer',
      name: 'Already authorized',
      host: 'localhost',
      region: 'Test',
    });
    await until(
      async () =>
        (
          await sql`select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext(${inFlight.workspaceId})::bigint & 4294967295)::oid`
        ).length > 0,
    );
    deactivate = sql`update "user" set active=false where id=${inFlight.id}`.then((r) => r);
    await until(
      async () =>
        (
          await sql`select 1 from pg_stat_activity where wait_event_type='Lock' and query ilike 'update "user" set active=false%'`
        ).length > 0,
    );
  } finally {
    await quotaBlock`select pg_advisory_unlock(hashtext(${inFlight.workspaceId}))`;
    quotaBlock.release();
  }
  const [created] = await Promise.all([creation!, deactivate!]);
  assert.equal(created.status, 200);
  const [person] = await sql`select active from "user" where id=${inFlight.id}`;
  assert.equal(person.active, false);
  console.log('PASS deactivation waits for a previously authorized mutation to commit');
} finally {
  for (const id of spaces) await sql`delete from workspace where id=${id}`;
  for (const id of ids) await sql`delete from "user" where id=${id}`;
  await sql.end();
}
