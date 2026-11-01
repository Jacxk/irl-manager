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
try {
  const inviter = await account(),
    destination = await account(),
    recipient = await account();
  const stale = randomUUID(),
    move = randomUUID();
  await sql`insert into invitation (id, "workspaceId", "userId", role) values (${stale}, ${inviter.workspaceId}, ${recipient.id}, 'operator'), (${move}, ${destination.workspaceId}, ${inviter.id}, 'operator')`;
  assert.equal(
    (await command(inviter.cookie, { action: 'acceptInvitation', invitationId: move })).status,
    200,
  );
  const result = await command(recipient.cookie, {
    action: 'acceptInvitation',
    invitationId: stale,
  });
  assert.ok(
    [404, 409].includes(result.status),
    `Stale invitation admitted user to ownerless workspace: ${result.status}`,
  );
  const [membership] = await sql`select "workspaceId" from member where "userId"=${recipient.id}`;
  assert.equal(membership.workspaceId, recipient.workspaceId);
  console.log('PASS stale invitations cannot admit members into an abandoned workspace');
  const racingOwner = await account(),
    racer = await account();
  const arrival = randomUUID(),
    departure = randomUUID();
  await sql`insert into invitation (id, "workspaceId", "userId", role) values (${arrival}, ${racingOwner.workspaceId}, ${racer.id}, 'operator'), (${departure}, ${destination.workspaceId}, ${racingOwner.id}, 'operator')`;
  const responses = await Promise.all([
    command(racingOwner.cookie, { action: 'acceptInvitation', invitationId: departure }),
    command(racer.cookie, { action: 'acceptInvitation', invitationId: arrival }),
  ]);
  const statuses = responses.map((r) => r.status);
  assert.ok(
    (statuses[0] === 200 && [404, 409].includes(statuses[1])) ||
      (statuses[0] === 409 && statuses[1] === 200),
    `Unexpected departure/arrival outcome: ${statuses}`,
  );
  const orphans =
    await sql`select m.id from member m where m."userId" in (${racingOwner.id},${racer.id}) and not exists(select 1 from member o where o."workspaceId"=m."workspaceId" and o.role='owner')`;
  assert.equal(orphans.length, 0);
  console.log('PASS competing departure and arrival preserve a workspace owner');
} finally {
  for (const id of spaces) await sql`delete from workspace where id=${id}`;
  for (const id of ids) await sql`delete from "user" where id=${id}`;
  await sql.end();
}
