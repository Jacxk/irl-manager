import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { db, sql } from '../src/lib/db';
import { user, workspace, mediaServer, channel as channelTable } from '../src/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const suffix = randomUUID();
const accounts: { cookie: string; id: string }[] = [];
const workspaces: string[] = [];
let retained = false;
async function signup(name: string) {
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name, email: `${name}-${suffix}@example.test`, password: randomUUID() }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const json = await res.json();
  const cookie = res.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  const account = { cookie, id: json.user.id };
  accounts.push(account);
  return account;
}
async function get(cookie: string) {
  const res = await fetch(`${base}/api/control`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}
async function command(cookie: string, payload: Record<string, unknown>, status = 200) {
  const res = await fetch(`${base}/api/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, status, await res.clone().text());
  return res.json();
}
try {
  assert.equal((await fetch(`${base}/api/control`)).status, 401);
  const owner = await signup('owner');
  const outsider = await signup('outsider');
  for (const path of ['/api/control', '/api/nodes/installations']) {
    for (const body of ['{', 'null', '[]', '"command"']) {
      const invalid = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: base, Cookie: owner.cookie },
        body,
      });
      assert.equal(invalid.status, 400, `${path}: ${await invalid.text()}`);
    }
  }
  let one = await get(owner.cookie);
  const two = await get(outsider.cookie);
  workspaces.push(one.workspace.id, two.workspace.id);
  assert.notEqual(one.workspace.id, two.workspace.id);
  await command(owner.cookie, {
    action: 'createServer',
    name: `Integration server ${suffix}`,
    host: 'localhost',
    region: 'Test',
  });
  one = await get(owner.cookie);
  const server = one.servers.find(
    (s: { name: string }) => s.name === `Integration server ${suffix}`,
  );
  await command(
    outsider.cookie,
    { action: 'createChannel', name: 'Forbidden', serverId: server.id, protocol: 'srt' },
    404,
  );
  await command(owner.cookie, {
    action: 'createChannel',
    name: 'Integration stream',
    serverId: server.id,
    protocol: 'srt',
  });
  one = await get(owner.cookie);
  const channel = one.channels[0];
  assert.equal(channel.ingestKey, undefined);
  await command(outsider.cookie, { action: 'credentials', channelId: channel.id }, 404);
  const credentials = await command(owner.cookie, { action: 'credentials', channelId: channel.id });
  assert.ok(credentials.key);
  await command(owner.cookie, {
    action: 'addDestination',
    channelId: channel.id,
    name: 'Sink one',
    provider: 'custom',
    url: 'rtmp://sink:1935/live',
    key: 'stream-one',
  });
  await command(owner.cookie, {
    action: 'addDestination',
    channelId: channel.id,
    name: 'Sink two',
    provider: 'custom',
    url: 'rtmp://sink:1935/live',
    key: 'stream-two',
  });
  one = await get(owner.cookie);
  assert.equal(one.destinations.length, 2);
  assert.ok(one.destinations.every((d: Record<string, unknown>) => !d.encryptedKey && !d.key));
  const stored = await db.query.destination.findFirst({
    where: eq((await import('../src/lib/db/schema')).destination.channelId, channel.id),
  });
  assert.ok(stored && !stored.encryptedKey.includes('stream-one'));
  await command(
    outsider.cookie,
    {
      action: 'updateServer',
      serverId: server.id,
      name: 'Hijack',
      host: 'evil.example',
      region: 'X',
    },
    404,
  );
  await command(owner.cookie, {
    action: 'updateServer',
    serverId: server.id,
    name: `Integration server ${suffix}`,
    host: 'live.example',
    region: 'Test',
  });
  one = await get(owner.cookie);
  assert.equal(
    one.servers.find((s: { id: string }) => s.id === server.id).host,
    'live.example',
  );
  const target = one.destinations[0];
  const beforeKey = (
    await db.query.destination.findFirst({
      where: eq((await import('../src/lib/db/schema')).destination.id, target.id),
    })
  )?.encryptedKey;
  await command(owner.cookie, {
    action: 'updateDestination',
    channelId: channel.id,
    destinationId: target.id,
    name: 'Sink renamed',
    provider: 'custom',
    url: 'rtmp://sink:1935/backup',
  });
  one = await get(owner.cookie);
  const renamed = one.destinations.find((d: { id: string }) => d.id === target.id);
  assert.equal(renamed.name, 'Sink renamed');
  assert.equal(renamed.url, 'rtmp://sink:1935/backup');
  assert.equal(renamed.key, undefined);
  const afterKey = (
    await db.query.destination.findFirst({
      where: eq((await import('../src/lib/db/schema')).destination.id, target.id),
    })
  )?.encryptedKey;
  assert.equal(afterKey, beforeKey);
  await command(owner.cookie, { action: 'start', channelId: channel.id }, 409); // Worker is offline.
  const rejected = await fetch(`${base}/api/control`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example',
      Cookie: owner.cookie,
    },
    body: JSON.stringify({ action: 'stop', channelId: channel.id }),
  });
  assert.equal(rejected.status, 403);
  await command(owner.cookie, {
    action: 'addMember',
    email: `outsider-${suffix}@example.test`,
    role: 'operator',
  });
  let other = await get(outsider.cookie);
  assert.equal(other.workspace.id, two.workspace.id);
  assert.equal(other.invitations.length, 1);
  // Shared nodes need no personal node in the joining owner's workspace.
  await db.update(mediaServer).set({ shared: true }).where(eq(mediaServer.id, server.id));
  await command(outsider.cookie, {
    action: 'createChannel',
    name: 'Shared-node broadcast',
    serverId: server.id,
    protocol: 'srt',
  });
  await command(
    outsider.cookie,
    {
      action: 'acceptInvitation',
      invitationId: other.invitations[0].id,
    },
    409,
  );
  assert.equal((await get(outsider.cookie)).workspace.id, two.workspace.id);
  await db.delete(channelTable).where(eq(channelTable.workspaceId, two.workspace.id));
  await command(outsider.cookie, {
    action: 'acceptInvitation',
    invitationId: other.invitations[0].id,
  });
  other = await get(outsider.cookie);
  assert.equal(other.workspace.id, one.workspace.id);
  assert.equal(other.role, 'operator');
  await command(
    outsider.cookie,
    { action: 'createServer', name: 'Forbidden', host: 'localhost', region: 'Test' },
    403,
  );
  await command(
    outsider.cookie,
    {
      action: 'updateServer',
      serverId: server.id,
      name: 'Forbidden',
      host: 'localhost',
      region: 'Test',
    },
    403,
  );
  await command(
    outsider.cookie,
    {
      action: 'updateDestination',
      channelId: channel.id,
      destinationId: one.destinations[0].id,
      name: 'Forbidden',
      provider: 'custom',
      url: 'rtmp://sink:1935/live',
    },
    403,
  );
  await command(outsider.cookie, { action: 'rotateKey', channelId: channel.id }, 403);
  if (process.env.KEEP_TEST_FIXTURE === '1') {
    writeFileSync(
      '/tmp/irl-manager-fixture.json',
      JSON.stringify({ owner, outsider, workspaces, server, channel, credentials }),
      { mode: 0o600 },
    );
    retained = true;
    console.log('API integration passed. Private media-test fixture retained in /tmp.');
  } else
    console.log(
      'API integration passed: sessions, isolation, multi-destination CRUD, encrypted keys, CSRF, invitations, roles.',
    );
} finally {
  if (!retained) {
    if (workspaces.length) await db.delete(workspace).where(inArray(workspace.id, workspaces));
    for (const account of accounts) await db.delete(user).where(eq(user.id, account.id));
  }
  await sql.end();
}
