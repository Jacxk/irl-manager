import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { chromium, expect } from '@playwright/test';
import { sql } from '../src/lib/db';
import { encrypt } from '../src/lib/crypto';
import { moblinAuthentication } from '../src/lib/moblin/protocol';
import { startMoblinGateway } from '../moblin/server';
import { runMoblinMedia } from './moblin-media';
import { moblinPreviews } from '../src/lib/moblin/previews';
import { readSettings } from '../src/lib/settings';
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_moblin_verify'));
const base = 'http://localhost:3160';
process.env.BETTER_AUTH_URL = base;
process.env.LOCK_BY_ENVIRONMENT = 'false';
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3160'], {
  env: process.env,
  stdio: 'ignore',
});
const gateway = await startMoblinGateway({ host: '127.0.0.1', port: 0 });
const address = gateway.server.address();
assert.ok(address && typeof address !== 'string');
const gatewayBase = `ws://127.0.0.1:${address.port}/moblin`;
const peers: Peer[] = [];
const userIds: string[] = [],
  workspaceIds: string[] = [];
const nodeId = randomUUID(),
  id = randomUUID(),
  otherId = randomUUID();
let heartbeat: ReturnType<typeof setInterval> | undefined;
async function waitFor(check: () => Promise<boolean>, message: string, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}
class Peer {
  ws: WebSocket;
  messages: Record<string, unknown>[] = [];
  closed = false;
  constructor(channelId: string, origin?: string) {
    this.ws = new WebSocket(`${gatewayBase}/${channelId}`, origin ? { origin } : {});
    this.ws.on('message', (buffer) => {
      this.messages.push(JSON.parse(buffer.toString()));
    });
    this.ws.on('close', () => {
      this.closed = true;
    });
    this.ws.on('error', () => {});
    peers.push(this);
  }
  send(value: unknown) {
    this.ws.send(JSON.stringify(value));
  }
  async auth(password: string) {
    await waitFor(
      async () => this.closed || this.messages.some((m) => 'hello' in m),
      'No Moblin hello',
    );
    assert.equal(this.closed, false, 'Upgrade rejected');
    const hello = this.messages.find((m) => 'hello' in m)!.hello as {
      authentication: { salt: string; challenge: string };
    };
    this.send({
      identify: {
        authentication: moblinAuthentication(
          password,
          hello.authentication.salt,
          hello.authentication.challenge,
        ),
      },
    });
    await waitFor(
      async () => this.closed || this.messages.some((m) => 'identified' in m),
      'No identification result',
    );
    return (
      !this.closed &&
      !!(this.messages.find((m) => 'identified' in m)!.identified as { result: { ok?: unknown } })
        .result.ok
    );
  }
  state(streaming: boolean) {
    this.send({ event: { data: { state: { data: { streaming } } } } });
  }
  bitrate(kbps: number) {
    this.send({
      event: {
        data: {
          status: { topRight: { bitrateInfo: { bitsPerSecond: kbps * 1000, totalBytes: 1 } } },
        },
      },
    });
  }
  async close() {
    this.ws.close();
    await waitFor(async () => this.closed, 'Socket did not close');
  }
}
async function signup(name: string) {
  const r = await fetch(base + '/api/auth/sign-up/email', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: `${randomUUID()}@example.test`, password: randomUUID() }),
  });
  assert.equal(r.status, 200);
  const user = (await r.json()).user;
  userIds.push(user.id);
  const cookie = r.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  const data = await (await fetch(base + '/api/control', { headers: { Cookie: cookie } })).json();
  workspaceIds.push(data.workspace.id);
  return { id: user.id as string, cookie, workspace: data.workspace.id as string };
}
async function row() {
  return (await sql`select * from moblin_pairing where "channelId"=${id}`)[0];
}
async function currentChannel() {
  return (await sql`select * from channel where id=${id}`)[0];
}
let ownerCookie = '';
async function setup(payload: object, expected = 200, cookie = ownerCookie, channelId = id) {
  const r = await fetch(base + `/api/channels/${channelId}/moblin`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(r.status, expected, `Unexpected Moblin mutation status ${r.status}`);
  return r.json();
}
async function settings(cookie: string, key: string, value: unknown, expected = 200) {
  const data = await (await fetch(base + '/api/admin', { headers: { Cookie: cookie } })).json();
  const field = data.fields.find((f: { key: string }) => f.key === key);
  const r = await fetch(base + '/api/admin', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'settings',
      changes: [{ key, value, revision: field.revision }],
    }),
  });
  assert.equal(r.status, expected);
}
try {
  for (let i = 0; i < 60; i++) {
    assert.equal(app.exitCode, null);
    try {
      if ((await fetch(base + '/login')).ok) break;
    } catch {}
    await delay(200);
  }
  const owner = await signup('Moblin owner'),
    outsider = await signup('Outsider'),
    operator = await signup('Operator');
  ownerCookie = owner.cookie;
  await sql`update "user" set "instanceRole"='admin' where id=${owner.id}`;
  await sql`update member set "workspaceId"=${owner.workspace},role='operator' where "userId"=${operator.id}`;
  await sql`insert into media_server(id,"workspaceId",name,host,region,"heartbeatAt") values(${nodeId},${owner.workspace},'Moblin fixture','localhost','Test',now())`;
  for (const channelId of [id, otherId])
    await sql`insert into channel(id,"workspaceId","serverId",name,protocol,"ingestKey") values(${channelId},${owner.workspace},${nodeId},'Moblin channel','srt','fixture-ingest-key')`;
  heartbeat = setInterval(() => {
    void sql`update media_server set "heartbeatAt"=now() where id=${nodeId}`;
  }, 2000);
  await sql`update channel set name='Primary Moblin fixture' where id=${id}`;
  const path = base + `/api/channels/${id}/moblin`;
  assert.equal((await fetch(path)).status, 401);
  assert.equal((await fetch(path, { headers: { Cookie: outsider.cookie } })).status, 404);
  const initial = await (await fetch(path, { headers: { Cookie: owner.cookie } })).json();
  assert.equal(initial.config.enabled, false);
  assert.equal(initial.config.syncBroadcast, false);
  assert.equal(initial.config.lowBitrateKbps, 500);
  assert.equal(initial.gatewayReady, true);
  const config = {
    ...initial.config,
    enabled: true,
    syncBroadcast: true,
    lowBitrateSeconds: 2,
    recoverySeconds: 2,
  };
  for (const body of ['{', 'null', '[]', '"command"']) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { Cookie: owner.cookie, Origin: base, 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(r.status, 400);
  }
  await setup({ action: 'save', revision: 0, ...config }, 403, operator.cookie);
  await setup({ action: 'save', revision: 0, ...config }, 404, outsider.cookie);
  await setup({ action: 'save', revision: 0, ...config, lowBitrateKbps: -1 }, 400);
  const first = await setup({ action: 'save', revision: 0, ...config });
  assert.ok(first.password.length >= 32);
  assert.notEqual((await row()).encryptedPassword, first.password);
  const publicState = await (await fetch(path, { headers: { Cookie: owner.cookie } })).json();
  assert.equal(publicState.password, undefined);
  assert.equal(publicState.encryptedPassword, undefined);
  await setup({ action: 'save', revision: 0, ...config }, 409);
  const wrong = new Peer(id);
  assert.equal(await wrong.auth('wrong-password'), false);
  await waitFor(async () => wrong.closed, 'Bad password did not close');
  const preAuth = new Peer(id);
  await waitFor(async () => preAuth.messages.length > 0, 'No hello');
  preAuth.state(true);
  await waitFor(async () => preAuth.closed, 'Unauthenticated state was accepted');
  let peer = new Peer(id);
  assert.equal(await peer.auth(first.password), true);
  peer.send({ ping: {} });
  await waitFor(async () => peer.messages.some((m) => 'pong' in m), 'No native Moblin pong');
  // Pairing an already-live phone is a snapshot, not a broadcast command.
  peer.state(true);
  await waitFor(async () => (await row()).lastStreaming === true, 'Initial snapshot not received');
  assert.equal((await currentChannel()).desired, 'stopped');
  const previewToken = (await row()).previewSessionId;
  assert.ok(previewToken, 'Streaming snapshot should request a protected preview');
  const policies = (await readSettings()).values;
  assert.equal(
    (await moblinPreviews([nodeId], policies)).selected.get(id)?.sessionId,
    previewToken,
  );
  assert.equal(
    (await moblinPreviews([nodeId], { ...policies, maxMoblinPreviewPrograms: 0 })).selected.size,
    0,
  );
  assert.equal(
    (await moblinPreviews([nodeId], { ...policies, allowPreLivePreview: false })).selected.size,
    0,
  );
  assert.equal(
    (await moblinPreviews([nodeId], { ...policies, allowMoblinControl: false })).selected.size,
    0,
  );
  assert.equal((await moblinPreviews([randomUUID()], policies)).selected.size, 0);
  await sql`update moblin_pairing set "pairedBy"=${outsider.id} where "channelId"=${id}`;
  assert.equal(
    (await moblinPreviews([nodeId], policies)).selected.size,
    0,
    'Revoked creator must not receive media resources',
  );
  await sql`update moblin_pairing set "pairedBy"=${owner.id} where "channelId"=${id}`;
  peer.state(false);
  await waitFor(async () => (await row()).lastStreaming === false, 'Stop snapshot not saved');
  assert.equal((await row()).previewSessionId, null);
  peer.state(true);
  await waitFor(async () => !!(await row()).lastError, 'No-destination guard not enforced');
  assert.equal((await currentChannel()).desired, 'stopped');
  const manualStart = await fetch(base + '/api/control', {
    method: 'POST',
    headers: { Cookie: owner.cookie, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', channelId: id }),
  });
  assert.equal(manualStart.status, 400);
  await sql`insert into destination(id,"channelId",name,provider,url,"encryptedKey") values(${randomUUID()},${id},'Isolated sink','custom','rtmp://127.0.0.1:1/live',${encrypt('fixture-key')})`;
  peer.state(false);
  peer.state(true);
  await waitFor(
    async () => (await currentChannel()).desired === 'running',
    'Moblin Go live did not start destinations',
  );
  const session = (await currentChannel()).sessionId;
  peer.bitrate(100);
  await delay(2100);
  peer.bitrate(100);
  await waitFor(
    async () => (await row()).lowBitrateActive === true,
    'Sustained low bitrate did not enable BRB',
  );
  assert.equal((await currentChannel()).desired, 'running');
  const nodeToken = randomUUID(),
    nodeInstance = randomUUID();
  await sql`update media_server set "agentTokenHash"=${createHash('sha256').update(nodeToken).digest('hex')} where id=${nodeId}`;
  const agentConfig = async () => {
    const r = await fetch(base + '/api/nodes/agent/config', {
      headers: {
        Authorization: `Bearer ${nodeToken}`,
        'x-node-id': nodeId,
        'x-node-instance': nodeInstance,
        'x-media-ready': '1',
      },
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  assert.equal(
    (await agentConfig()).channels.find((c: { id: string }) => c.id === id).automaticFallback,
    true,
  );
  peer.bitrate(1000);
  await delay(2100);
  peer.bitrate(1000);
  await waitFor(
    async () => (await row()).lowBitrateActive === false,
    'Stable bitrate did not recover',
  );
  assert.equal(
    (await agentConfig()).channels.find((c: { id: string }) => c.id === id).automaticFallback,
    false,
  );
  // Network/control loss is never Stop; the same session survives reconnect.
  await peer.close();
  await waitFor(async () => (await row()).connectionId === null, 'Lease not released');
  assert.equal((await currentChannel()).desired, 'running');
  assert.equal((await currentChannel()).sessionId, session);
  peer = new Peer(id);
  assert.equal(await peer.auth(first.password), true);
  peer.state(true);
  await delay(100);
  assert.equal((await currentChannel()).sessionId, session);
  peer.state(false);
  await waitFor(
    async () => (await currentChannel()).desired === 'stopped',
    'Explicit Moblin Stop did not end destinations',
  );
  assert.equal((await currentChannel()).endReason, 'intentional');
  // Explicit Stop while offline is reflected by the first false reconnect snapshot.
  peer.state(true);
  await waitFor(
    async () => (await currentChannel()).desired === 'running',
    'Second session not started',
  );
  await peer.close();
  await waitFor(async () => (await row()).connectionId === null, 'Lease not released');
  peer = new Peer(id);
  assert.equal(await peer.auth(first.password), true);
  peer.state(false);
  await waitFor(
    async () => (await currentChannel()).desired === 'stopped',
    'Offline stop snapshot ignored',
  );
  // Creator permission revocation invalidates a connected device.
  await sql`update member set role='operator' where "userId"=${owner.id}`;
  peer.state(true);
  await waitFor(async () => peer.closed, 'Revoked owner retained remote control');
  assert.equal((await currentChannel()).desired, 'stopped');
  await sql`update member set role='owner' where "userId"=${owner.id}`;
  const rotated = await setup({ action: 'rotate', revision: 1 });
  assert.notEqual(rotated.password, first.password);
  await settings(owner.cookie, 'maxMoblinConnections', 0, 400);
  await settings(owner.cookie, 'maxMoblinConnections', 1);
  peer = new Peer(id);
  assert.equal(await peer.auth(rotated.password), true);
  const otherInitial = await (
    await fetch(base + `/api/channels/${otherId}/moblin`, { headers: { Cookie: owner.cookie } })
  ).json();
  const other = await setup(
    { action: 'save', revision: 0, ...otherInitial.config, enabled: true },
    200,
    owner.cookie,
    otherId,
  );
  await sql`update moblin_pairing set "lastStreaming"=true,"previewSessionId"=${randomUUID()},"previewStartedAt"=now() where "channelId" in (${id},${otherId})`;
  const capped = await moblinPreviews([nodeId], { ...policies, maxMoblinPreviewPrograms: 1 });
  assert.equal(capped.selected.size, 1);
  assert.equal(capped.queued.size, 1);
  assert.equal((await currentChannel()).desired, 'stopped');
  await sql`update moblin_pairing set "lastStreaming"=false,"previewSessionId"=null where "channelId" in (${id},${otherId})`;
  const limit = new Peer(otherId);
  assert.equal(await limit.auth(other.password), false);
  await settings(owner.cookie, 'allowMoblinControl', false);
  peer.state(true);
  await waitFor(async () => peer.closed, 'Policy did not revoke active control');
  assert.equal((await currentChannel()).desired, 'stopped');
  await setup({ action: 'rotate', revision: 2 }, 403);
  await setup({ action: 'save', revision: 2, ...config }, 403);
  // Disable stays available even when instance policy is off.
  await setup({ action: 'save', revision: 2, ...config, enabled: false });
  await settings(owner.cookie, 'allowMoblinControl', true);
  let mediaPassword = rotated.password;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies(
      owner.cookie.split('; ').map((c) => {
        const i = c.indexOf('=');
        return { name: c.slice(0, i), value: c.slice(i + 1), url: base };
      }),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: /^Primary Moblin fixture/ }).click();
    await page.getByRole('button', { name: 'Set up Moblin', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Set up Moblin', exact: true }).click();
    await page.getByRole('heading', { name: 'Moblin remote control', exact: true }).waitFor();
    await page.getByRole('switch', { name: 'Enable pairing for this channel' }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
    await page.getByRole('switch', { name: 'Enable pairing for this channel' }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
    const existingPasswordField = page.getByLabel('New pairing password — shown only now', {
      exact: true,
    });
    const savedPassword = (await existingPasswordField.count())
      ? await existingPasswordField.inputValue()
      : '';
    await page.getByRole('button', { name: 'Replace pairing password', exact: true }).click();
    const passwordField = page.getByLabel('New pairing password — shown only now', { exact: true });
    await expect(passwordField).toHaveAttribute('type', 'password');
    await expect.poll(() => passwordField.inputValue()).not.toBe(savedPassword);
    await expect.poll(() => passwordField.inputValue()).not.toBe('');
    mediaPassword = await passwordField.inputValue();
    assert.ok(mediaPassword.length >= 32);
    assert.notEqual(mediaPassword, rotated.password);
    const visualPeer = new Peer(id);
    assert.equal(await visualPeer.auth(mediaPassword), true);
    await expect(
      page.getByRole('status', { name: 'Moblin remote control: Connected', exact: true }).first(),
    ).toBeVisible();
    visualPeer.ws.terminate();
    await expect(
      page
        .getByRole('status', { name: 'Moblin remote control: Disconnected', exact: true })
        .first(),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.deepEqual(errors, []);
    await page.keyboard.press('Escape');
    await page.goto(base + '/admin/moblin');
    await page
      .getByText('Allow optional Moblin pairing (applies to new and existing connections)', {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  } finally {
    await browser.close();
  }
  // Reauthorizing an orphaned/previous administrator's pairing must not retain
  // a password that the former administrator knows.
  await sql`update moblin_pairing set "pairedBy"=${outsider.id} where "channelId"=${id}`;
  const handoff = await setup({ action: 'save', revision: (await row()).revision, ...config });
  assert.ok(handoff.password?.length >= 32);
  assert.notEqual(handoff.password, mediaPassword);
  mediaPassword = handoff.password;
  if (process.env.TEST_MOBLIN_MEDIA === '1') {
    await setup({ action: 'save', revision: (await row()).revision, ...config });
    peer = new Peer(id);
    assert.equal(await peer.auth(mediaPassword), true);
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
    await runMoblinMedia({
      nodeId,
      channelId: id,
      nodeToken,
      live: (v) => peer.state(v),
      bitrate: (k) => peer.bitrate(k),
      disconnect: () => peer.ws.terminate(),
      reconnect: async () => {
        await waitFor(async () => !(await row()).connectionId, 'Connection not released');
        peer = new Peer(id);
        assert.equal(await peer.auth(mediaPassword), true);
      },
    });
  }
  console.log(
    'Moblin native handshake, secrets, role/tenant denial, optional sync, session guards, bitrate BRB/recovery, reconnect, offline Stop, revocation, limits, policy and mobile setup passed.',
  );
} finally {
  if (heartbeat) clearInterval(heartbeat);
  for (const peer of peers) peer.ws.terminate();
  await gateway.close();
  app.kill('SIGTERM');
  await once(app, 'exit');
  for (const workspace of workspaceIds) await sql`delete from workspace where id=${workspace}`;
  for (const user of userIds) await sql`delete from "user" where id=${user}`;
  await sql.end();
}
