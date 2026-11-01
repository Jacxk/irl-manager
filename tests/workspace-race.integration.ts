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
  for (const scenario of ['manual', 'wizard']) {
    const owner = await account(),
      destination = await account();
    const invite = randomUUID();
    await sql`insert into invitation (id, "workspaceId", "userId", role) values (${invite}, ${destination.workspaceId}, ${owner.id}, 'operator')`;
    const blocker = await sql.reserve();
    let creation: Promise<Response> | undefined, transfer: Promise<Response> | undefined;
    try {
      await blocker`select pg_advisory_lock(hashtext(${owner.workspaceId}))`;
      creation =
        scenario === 'wizard'
          ? fetch(base + '/api/nodes/installations', {
              method: 'POST',
              headers: { Cookie: owner.cookie, Origin: base, 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: 'ssh' }),
            })
          : command(owner.cookie, {
              action: 'createServer',
              name: 'Racing node',
              host: 'localhost',
              region: 'Test',
            });
      await until(
        async () =>
          (
            await sql`select 1 from pg_locks where locktype='advisory' and not granted and objid=(hashtext(${owner.workspaceId})::bigint & 4294967295)::oid`
          ).length > 0,
      );
      let transferDone = false;
      transfer = command(owner.cookie, { action: 'acceptInvitation', invitationId: invite }).then(
        (r) => {
          transferDone = true;
          return r;
        },
      );
      await until(
        async () =>
          transferDone ||
          (
            await sql`select 1 from pg_stat_activity where wait_event_type='Lock' and query ilike '%member%for update%'`
          ).length > 0,
      );
    } finally {
      await blocker`select pg_advisory_unlock(hashtext(${owner.workspaceId}))`;
      blocker.release();
    }
    const results = await Promise.all([creation!, transfer!]);
    const statuses = results.map((r) => r.status);
    assert.ok(
      !(statuses[0] === 200 && statuses[1] === 200),
      `Both operations succeeded: ${statuses}; node stranded in abandoned workspace`,
    );
    assert.equal(statuses[0], 200);
    assert.equal(statuses[1], 409);
    const [membership] = await sql`select "workspaceId" from member where "userId"=${owner.id}`;
    assert.equal(membership.workspaceId, owner.workspaceId);
    console.log(`PASS ${scenario} creation and concurrent transfer preserve workspace ownership`);
  }
} finally {
  for (const id of spaces) await sql`delete from workspace where id=${id}`;
  for (const id of ids) await sql`delete from "user" where id=${id}`;
  await sql.end();
}
