import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { channel, mediaServer, nodeInstallation } from '../src/lib/db/schema';
const file = '/tmp/irl-manager-fixture.json';
const fixture = JSON.parse(readFileSync(file, 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
async function api(path: string, method = 'GET', body?: unknown, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: { Origin: base, Cookie: fixture.owner.cookie, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
try {
  await db
    .update(channel)
    .set({ serverId: fixture.server.id })
    .where(eq(channel.id, fixture.channel.id));
  const remote = await db.query.mediaServer.findFirst({
    where: eq(mediaServer.id, fixture.remoteNodeId),
  });
  if (remote) await db.delete(mediaServer).where(eq(mediaServer.id, remote.id));
  if (fixture.duplicateId) {
    const duplicate = await db.query.nodeInstallation.findFirst({
      where: eq(nodeInstallation.id, fixture.duplicateId),
    });
    if (duplicate) await db.delete(mediaServer).where(eq(mediaServer.id, duplicate.nodeId));
  }
  const caps = await api('/api/nodes/installations');
  assert.equal(caps.localEnabled, true);
  assert.equal(caps.localInstalled, !!fixture.localInstallation);
  const job =
    fixture.localInstallation ?? (await api('/api/nodes/installations', 'POST', { mode: 'local' }));
  fixture.localInstallation = job;
  writeFileSync(file, JSON.stringify(fixture), { mode: 0o600 });
  await api('/api/nodes/installations', 'POST', { mode: 'local' }, 409);
  await api(`/api/nodes/installations/${job.id}`, 'PATCH', { action: 'check' });
  const end = Date.now() + 600000;
  let complete = false;
  while (Date.now() < end) {
    const current = (await api('/api/nodes/installations')).jobs.find(
      (j: { id: string }) => j.id === job.id,
    );
    if (current.status === 'failed')
      throw new Error(
        current.error +
          ' ' +
          current.logs
            .slice(-8)
            .map((l: { message: string }) => l.message)
            .join('\n'),
      );
    if (current.status === 'complete') {
      complete = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(complete, 'Local installation must connect its agent.');
  const installed = await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, job.nodeId) });
  assert.ok(installed?.machineId && installed.heartbeatAt);
  console.log(
    'PASS local one-click install builds services, connects its agent, and rejects a second local node',
  );
} finally {
  await sql.end();
}
