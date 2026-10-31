import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { channel, mediaServer, nodeInstallation } from '../src/lib/db/schema';
import { decrypt } from '../src/lib/crypto';
const fixturePath = '/tmp/irl-manager-fixture.json';
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
async function api(
  path: string,
  method = 'GET',
  body?: unknown,
  status = 200,
  cookie = fixture.owner.cookie,
) {
  const response = await fetch(base + path, {
    method,
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
async function job() {
  return (await api('/api/nodes/installations')).jobs.find(
    (j: { id: string }) => j.id === fixture.installation.id,
  );
}
async function until(label: string, check: () => Promise<boolean>, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) {
      console.log('PASS ' + label);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const result = await job();
  console.error({
    status: result.status,
    step: result.step,
    error: result.error,
    logs: result.logs.slice(-8),
  });
  throw new Error('Timed out: ' + label);
}
try {
  await api('/api/nodes/installations', 'GET', undefined, 403, fixture.outsider.cookie);
  await api('/api/nodes/installations', 'POST', { mode: 'local' }, 409);
  fixture.installation ??= await api('/api/nodes/installations', 'POST', { mode: 'ssh' });
  writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  const key = readFileSync('/tmp/irl-installer-test-key', 'utf8');
  const config = {
    ...fixture.installation.config,
    name: 'SSH integration node',
    host: 'localhost',
    region: 'Test',
    controlUrl: 'http://host.docker.internal:3000',
    sshHost: '127.0.0.1',
    sshPort: 22222,
    sshUser: 'root',
  };
  await api(`/api/nodes/installations/${fixture.installation.id}`, 'PATCH', {
    action: 'save',
    config,
    credentials: { privateKey: key },
  });
  const saved = await job();
  assert.ok(saved.hasCredentials);
  assert.equal(saved.encryptedCredentials, undefined);
  assert.ok(!JSON.stringify(saved).includes('BEGIN OPENSSH'));
  const record = await db.query.nodeInstallation.findFirst({
    where: eq(nodeInstallation.id, saved.id),
  });
  assert.ok(record?.encryptedCredentials && !record.encryptedCredentials.includes('BEGIN OPENSSH'));
  const publicState = await api('/api/control');
  assert.ok(
    publicState.servers.every(
      (n: Record<string, unknown>) => !n.encryptedAgentToken && !n.agentTokenHash,
    ),
  );
  const node = await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, saved.nodeId) });
  const nodeToken = decrypt(node!.encryptedAgentToken!);
  const instance = randomUUID();
  const headers = {
    Authorization: `Bearer ${nodeToken}`,
    'x-node-id': saved.nodeId,
    'x-node-instance': instance,
  };
  assert.equal(
    (
      await fetch(base + '/api/nodes/agent/config', {
        headers: { ...headers, Authorization: 'Bearer wrong-token' },
      })
    ).status,
    401,
  );
  await db
    .update(channel)
    .set({ serverId: saved.nodeId })
    .where(eq(channel.id, fixture.channel.id));
  const configResponse = await fetch(base + '/api/nodes/agent/config', { headers });
  assert.equal(configResponse.status, 200);
  const assigned = await configResponse.json();
  assert.equal(assigned.channels.length, 1);
  assert.equal(assigned.channels[0].id, fixture.channel.id);
  assert.equal(assigned.destinations.length, 2);
  assert.equal(
    (
      await fetch(base + '/api/nodes/agent/config', {
        headers: { ...headers, 'x-node-instance': randomUUID() },
      })
    ).status,
    409,
  );
  const sessionId = randomUUID();
  await db
    .update(channel)
    .set({ sessionId, desired: 'running', state: 'starting', startedAt: new Date() })
    .where(eq(channel.id, fixture.channel.id));
  const report = await fetch(base + '/api/nodes/agent/report', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changes: [
        {
          type: 'channel',
          id: fixture.channel.id,
          sessionId: randomUUID(),
          state: 'ended',
          endReason: 'timeout',
        },
      ],
    }),
  });
  assert.equal(report.status, 200);
  assert.equal(
    (await db.query.channel.findFirst({ where: eq(channel.id, fixture.channel.id) }))?.state,
    'starting',
  );
  await db
    .update(channel)
    .set({ desired: 'stopped', state: 'idle', sessionId: null, startedAt: null })
    .where(eq(channel.id, fixture.channel.id));
  await db
    .update(mediaServer)
    .set({ agentInstance: null, agentLeaseAt: null })
    .where(eq(mediaServer.id, saved.nodeId));
  console.log(
    'PASS draft persistence, encrypted SSH credentials, secret redaction, node-scoped configuration, agent lease, and stale-session report rejection',
  );
  await api(`/api/nodes/installations/${saved.id}`, 'PATCH', { action: 'check' });
  await until(
    'SSH host fingerprint is persisted for explicit verification',
    async () => (await job()).status === 'awaiting_trust',
  );
  const checked = await job();
  assert.match(checked.fingerprint, /^SHA256:/);
  await api(`/api/nodes/installations/${saved.id}`, 'PATCH', { action: 'trust' });
  await until(
    'SSH one-click installation builds services and connects the remote agent',
    async () => {
      const j = await job();
      if (j.status === 'failed')
        throw new Error(
          j.error +
            '\n' +
            j.logs
              .slice(-8)
              .map((l: { message: string }) => l.message)
              .join('\n'),
        );
      return j.status === 'complete';
    },
    900000,
  );
  const installed = await job();
  assert.equal(installed.hasCredentials, false);
  assert.ok(installed.logs.length > 5);
  assert.ok(!JSON.stringify(installed).includes(nodeToken));
  const capabilities = await api('/api/nodes/installations');
  assert.equal(
    capabilities.localInstalled,
    true,
    'Same Docker machine must be recognized even when installed through SSH',
  );
  fixture.remoteNodeId = saved.nodeId;
  writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  console.log('PASS completed setup clears SSH credentials and detects the current host singleton');
} finally {
  await sql.end();
}
