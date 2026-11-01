import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, copyFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { eq, count } from 'drizzle-orm';
import { chromium, expect } from '@playwright/test';
import { db, sql } from '../src/lib/db';
import {
  channel,
  destination,
  event,
  mediaServer,
  nodeInstallation,
  nodePreview,
} from '../src/lib/db/schema';
import { decrypt } from '../src/lib/crypto';
import { scanHost } from '../installer/transport';
const exec = promisify(execFile);
const fixture = JSON.parse(await readFile('/tmp/irl-manager-fixture.json', 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const suffix = randomUUID().slice(0, 8);
const target = `irl-remove-ssh-${suffix}`,
  sentinel = `irl-remove-unrelated-${suffix}`,
  sink = `irl-remove-sink-${suffix}`;
const nodeVolume = `irl-remove-data-${suffix}`,
  otherVolume = `irl-remove-unrelated-${suffix}`;
const block = `node_remove_test_${suffix}`;
await mkdir('.irl-installer', { recursive: true, mode: 0o700 });
const root = await mkdtemp(path.resolve('.irl-installer/removal-test-'));
let managed: { id: string; nodeId: string; config: Record<string, unknown> } | undefined;
let key = '';
let nodeToken = '';
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let ownsNamespace = false;
let blocked = false;
async function docker(...args: string[]) {
  return (await exec('docker', args, { maxBuffer: 5 * 1024 * 1024 })).stdout.trim();
}
async function api(
  url: string,
  method = 'GET',
  body?: unknown,
  status = 200,
  cookie = fixture.owner.cookie,
) {
  const res = await fetch(base + url, {
    method,
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(res.status, status, await res.clone().text());
  return res.json();
}
async function plan() {
  return api(`/api/nodes/${managed!.nodeId}/removal`);
}
async function until(label: string, check: () => Promise<boolean>, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) {
      console.log('PASS ' + label);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Timed out: ' + label);
}
try {
  let occupied = false;
  try {
    await docker('volume', 'inspect', 'irl-manager-node-identity');
    occupied = true;
  } catch {}
  assert.equal(
    occupied,
    false,
    'Use a disposable Docker host; a managed node identity already exists.',
  );
  assert.equal(
    await docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=irl-node'),
    '',
    'A node project already exists.',
  );
  assert.equal(
    await docker('volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=irl-node'),
    '',
    'Existing node volumes must be preserved.',
  );
  const machine = createHash('sha256')
    .update(await docker('info', '--format', '{{.ID}}'))
    .digest('hex');
  assert.equal(
    await db.query.mediaServer.findFirst({ where: eq(mediaServer.machineId, machine) }),
    undefined,
    'This Docker machine is registered to another node.',
  );
  await exec('ssh-keygen', ['-q', '-t', 'ed25519', '-f', path.join(root, 'key'), '-N', '']);
  key = await readFile(path.join(root, 'key'), 'utf8');
  await copyFile(path.join(root, 'key.pub'), path.join(root, 'authorized.pub'));
  await docker(
    'build',
    '-t',
    `irl-remove-ssh-image:${suffix}`,
    '-f',
    path.resolve('infra/ssh-test.Dockerfile'),
    root,
  );
  await docker(
    'run',
    '-d',
    '--name',
    target,
    '--network',
    'irl-manager_default',
    '-p',
    '127.0.0.1::22',
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    `irl-remove-ssh-image:${suffix}`,
  );
  const port = Number((await docker('port', target, '22/tcp')).split(':').at(-1));
  let pin = '';
  await until(
    'SSH fixture is ready',
    async () => {
      try {
        pin = await scanHost({ host: '127.0.0.1', port, username: 'root' });
        return true;
      } catch {
        return false;
      }
    },
    20000,
  );
  managed = await api('/api/nodes/installations', 'POST', { mode: 'ssh' });
  const node = await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, managed!.nodeId) });
  nodeToken = decrypt(node!.encryptedAgentToken!);
  const owner = createHash('sha256').update(nodeToken).digest('hex') + ':' + managed!.nodeId;
  const name = 'Permanent removal test ' + suffix;
  await db
    .update(mediaServer)
    .set({ name, host: 'localhost', machineId: machine })
    .where(eq(mediaServer.id, managed!.nodeId));
  await db
    .update(nodeInstallation)
    .set({
      status: 'complete',
      startedAt: new Date(),
      fingerprint: pin,
      encryptedCredentials: null,
      config: {
        ...managed!.config,
        name,
        host: 'localhost',
        sshHost: target,
        sshPort: 22,
        sshUser: 'root',
        sshAuth: 'key',
      } as typeof nodeInstallation.$inferInsert.config,
    })
    .where(eq(nodeInstallation.id, managed!.id));
  // A real media worker will send two continuous fallback outputs to this sink.
  const config = await readFile('infra/mediamtx.yml', 'utf8');
  await writeFile(
    path.join(root, 'mediamtx.yml'),
    config.replace('http://web:3000/api/media/auth', 'http://irl-node-worker-1:9000/auth'),
  );
  const existingNetworks = await docker(
    'network',
    'ls',
    '-q',
    '--filter',
    'name=^irl-node_default$',
  );
  if (existingNetworks) {
    const network = JSON.parse(await docker('network', 'inspect', 'irl-node_default'))[0];
    assert.equal(Object.keys(network.Containers ?? {}).length, 0);
  } else
    await docker(
      'network',
      'create',
      '--label',
      'com.docker.compose.project=irl-node',
      'irl-node_default',
    );
  await docker('volume', 'create', 'irl-manager-node-identity');
  ownsNamespace = true;
  await docker(
    'run',
    '--rm',
    '-v',
    'irl-manager-node-identity:/identity',
    'alpine:3.21',
    'sh',
    '-c',
    'mkdir -p /identity/claim; printf "%s" "$1" > /identity/claim/owner',
    'sh',
    owner,
  );
  await docker(
    'exec',
    target,
    'sh',
    '-c',
    'umask 077; mkdir -p /var/lib/irl-manager-node; printf "NODE_ID=%s\\nNODE_TOKEN=%s\\n" "$1" "$2" > /var/lib/irl-manager-node/.env; printf node-private > /var/lib/irl-manager-node/private-data',
    'sh',
    managed!.nodeId,
    nodeToken,
  );
  await docker('volume', 'create', '--label', 'com.docker.compose.project=irl-node', nodeVolume);
  await docker('volume', 'create', otherVolume);
  await docker(
    'run',
    '-d',
    '--init',
    '--name',
    sentinel,
    '-v',
    `${otherVolume}:/keep`,
    'alpine:3.21',
    'sh',
    '-c',
    'echo preserve-me > /keep/data; exec sleep 3600',
  );
  await docker(
    'run',
    '-d',
    '--name',
    sink,
    '-p',
    '127.0.0.1::9997',
    '-p',
    '127.0.0.1::1935',
    '-v',
    path.resolve('infra/sink-test.yml') + ':/mediamtx.yml:ro',
    'bluenviron/mediamtx:1.15.6',
  );
  const sinkApi =
    'http://127.0.0.1:' + Number((await docker('port', sink, '9997/tcp')).split(':').at(-1));
  const sinkPort = Number((await docker('port', sink, '1935/tcp')).split(':').at(-1));
  await db
    .update(channel)
    .set({
      serverId: managed!.nodeId,
      desired: 'running',
      state: 'starting',
      sessionId: randomUUID(),
      startedAt: new Date(),
      graceSeconds: 300,
    })
    .where(eq(channel.id, fixture.channel.id));
  await db
    .update(destination)
    .set({ url: `rtmp://host.docker.internal:${sinkPort}/live` })
    .where(eq(destination.channelId, fixture.channel.id));
  await db.insert(event).values({
    id: randomUUID(),
    channelId: fixture.channel.id,
    kind: 'session',
    message: 'Deletion history fixture',
  });
  await db.insert(nodePreview).values({
    id: randomUUID(),
    nodeId: managed!.nodeId,
    path: `program_${fixture.channel.id}/index.m3u8`,
    expiresAt: new Date(Date.now() + 300000),
  });
  await docker(
    'run',
    '-d',
    '--name',
    'irl-node-media-1',
    '--label',
    'com.docker.compose.project=irl-node',
    '--label',
    'com.docker.compose.service=media',
    '--network',
    'irl-node_default',
    '-v',
    path.join(root, 'mediamtx.yml') + ':/mediamtx.yml:ro',
    'bluenviron/mediamtx:1.15.6',
  );
  await docker(
    'run',
    '-d',
    '--init',
    '--name',
    'irl-node-srtla-1',
    '--label',
    'com.docker.compose.project=irl-node',
    '--label',
    'com.docker.compose.service=srtla',
    '--network',
    'irl-node_default',
    'alpine:3.21',
    'sleep',
    '3600',
  );
  await docker(
    'run',
    '-d',
    '--name',
    'irl-node-worker-1',
    '--label',
    'com.docker.compose.project=irl-node',
    '--label',
    'com.docker.compose.service=worker',
    '--network',
    'irl-node_default',
    '--add-host',
    'host.docker.internal:host-gateway',
    '-e',
    'NODE_ID=' + managed!.nodeId,
    '-e',
    'NODE_TOKEN=' + nodeToken,
    '-e',
    'MEDIA_WORKER_TOKEN=' + nodeToken,
    '-e',
    'CONTROL_URL=http://host.docker.internal:3000',
    '-e',
    'ALLOW_INSECURE_NODE_CONTROL=1',
    '-e',
    'MEDIA_INTERNAL_HOST=irl-node-media-1',
    '-v',
    nodeVolume + ':/node-data',
    'irl-manager-worker',
  );
  const sinkPaths = async () => {
    try {
      return (await (await fetch(sinkApi + '/v3/paths/list')).json()).items.filter(
        (p: { ready: boolean }) => p.ready,
      );
    } catch {
      return [];
    }
  };
  await until(
    'test node is broadcasting to two providers',
    async () => (await sinkPaths()).length === 2,
  );
  await api(
    `/api/nodes/${managed!.nodeId}/removal`,
    'POST',
    { confirmation: name, permanent: true },
    403,
    fixture.outsider.cookie,
  );
  await api(
    `/api/nodes/${managed!.nodeId}/removal`,
    'POST',
    { confirmation: 'wrong', permanent: true },
    400,
  );
  await api(
    `/api/nodes/${managed!.nodeId}/removal`,
    'POST',
    { confirmation: name, permanent: false },
    400,
  );
  await api(
    `/api/nodes/${managed!.nodeId}/removal`,
    'POST',
    { confirmation: name, permanent: true },
    400,
  );
  const before = await plan();
  assert.equal(before.counts.channels, 1);
  assert.equal(before.counts.destinations, 2);
  assert.ok(before.counts.events >= 1);
  // Wrong machine identity must fail before destructive commands.
  await db
    .update(mediaServer)
    .set({ machineId: createHash('sha256').update(randomUUID()).digest('hex') })
    .where(eq(mediaServer.id, managed!.nodeId));
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(
    fixture.owner.cookie.split('; ').map((v: string) => {
      const i = v.indexOf('=');
      return { name: v.slice(0, i), value: v.slice(i + 1), url: base };
    }),
  );
  const page = await context.newPage();
  await page.goto(base + '/?view=nodes');
  await page.getByRole('button', { name: `Permanently remove ${name}`, exact: true }).click();
  const remove = page.getByRole('button', { name: 'Permanently remove node', exact: true });
  await expect(remove).toBeDisabled();
  await page.getByLabel('Node name confirmation').fill('wrong');
  await page.getByRole('checkbox').check();
  await expect(remove).toBeDisabled();
  await page.getByLabel('Node name confirmation').fill(name);
  await page.getByLabel('Private key', { exact: true }).fill(key);
  await expect(remove).toBeEnabled();
  await remove.click();
  await until(
    'wrong target is rejected and application data is retained',
    async () => (await plan()).installation.status === 'remove_failed',
  );
  assert.ok((await plan()).installation.error.includes('different Docker host'));
  assert.equal(
    await docker('inspect', '--format', '{{.State.Running}}', 'irl-node-worker-1'),
    'true',
  );
  assert.ok(await db.query.channel.findFirst({ where: eq(channel.id, fixture.channel.id) }));
  assert.equal(
    (
      await fetch(base + '/api/nodes/agent/config', {
        headers: {
          Authorization: 'Bearer ' + nodeToken,
          'x-node-id': managed!.nodeId,
          'x-node-instance': randomUUID(),
        },
      })
    ).status,
    410,
  );
  await api('/api/control', 'POST', { action: 'start', channelId: fixture.channel.id }, 409);
  await api(`/api/nodes/installations/${managed!.id}`, 'PATCH', { action: 'check' }, 409);
  await db
    .update(mediaServer)
    .set({ machineId: machine })
    .where(eq(mediaServer.id, managed!.nodeId));
  await sql.unsafe(`CREATE TABLE "${block}" ("nodeId" text REFERENCES "media_server"("id"))`);
  blocked = true;
  await sql.unsafe(`INSERT INTO "${block}" VALUES ($1)`, [managed!.nodeId]);
  await api(`/api/nodes/${managed!.nodeId}/removal`, 'POST', {
    confirmation: name,
    permanent: true,
  });
  await until('remote resources are removed before application deletion is committed', async () => {
    const current = await plan();
    return current.installation.status === 'remove_failed' && current.installation.remoteCleaned;
  });
  assert.ok(
    await db.query.channel.findFirst({ where: eq(channel.id, fixture.channel.id) }),
    'Failed DB deletion must roll back channels/history',
  );
  assert.equal((await plan()).installation.hasCredentials, false);
  assert.equal(
    await docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=irl-node'),
    '',
  );
  assert.equal(
    await docker('volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=irl-node'),
    '',
  );
  assert.equal(
    await docker('network', 'ls', '-q', '--filter', 'label=com.docker.compose.project=irl-node'),
    '',
  );
  await assert.rejects(() => docker('volume', 'inspect', 'irl-manager-node-identity'));
  assert.equal(
    await docker('exec', target, 'sh', '-c', 'test ! -e /var/lib/irl-manager-node && echo removed'),
    'removed',
  );
  assert.equal((await sinkPaths()).length, 0);
  assert.equal(await docker('inspect', '--format', '{{.State.Running}}', sentinel), 'true');
  assert.equal(await docker('exec', sentinel, 'cat', '/keep/data'), 'preserve-me');
  await sql.unsafe(`DROP TABLE "${block}"`);
  blocked = false;
  await docker('stop', target);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: `Permanently remove ${name}`, exact: true }).click();
  await expect(page.getByText('Remote cleanup already succeeded.', { exact: false })).toBeVisible();
  await page.getByLabel('Node name confirmation').fill(name);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Retry permanent removal', exact: true }).click();
  await until(
    'retry finishes database cleanup without SSH and deletes all node records',
    async () => {
      const r = await fetch(base + `/api/nodes/${managed!.nodeId}/removal`, {
        headers: { Cookie: fixture.owner.cookie },
      });
      return r.status === 404;
    },
  );
  assert.equal(
    await db.query.channel.findFirst({ where: eq(channel.id, fixture.channel.id) }),
    undefined,
  );
  assert.equal(
    (
      await db
        .select({ value: count() })
        .from(destination)
        .where(eq(destination.channelId, fixture.channel.id))
    )[0].value,
    0,
  );
  assert.equal(
    (
      await db.select({ value: count() }).from(event).where(eq(event.channelId, fixture.channel.id))
    )[0].value,
    0,
  );
  assert.equal(
    (
      await db
        .select({ value: count() })
        .from(nodePreview)
        .where(eq(nodePreview.nodeId, managed!.nodeId))
    )[0].value,
    0,
  );
  assert.equal(
    await db.query.nodeInstallation.findFirst({
      where: eq(nodeInstallation.nodeId, managed!.nodeId),
    }),
    undefined,
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const draft = await api('/api/nodes/installations', 'POST', { mode: 'ssh' });
  const draftPlan = await api(`/api/nodes/${draft.nodeId}/removal`);
  assert.equal(draftPlan.neverInstalled, true);
  const deleted = await api(`/api/nodes/${draft.nodeId}/removal`, 'POST', {
    confirmation: draftPlan.node.name,
    permanent: true,
  });
  assert.equal(deleted.removed, true);
  await api(`/api/nodes/${draft.nodeId}/removal`, 'GET', undefined, 404);
  console.log('PASS unused installation draft is removed without SSH');

  // Exercise the local uninstall path inside the real installer, using only a
  // generated test directory. The normal local-node directory is never touched.
  const localRoot = `/var/lib/irl-installer/removal-test-${suffix}`;
  const localNodeId = randomUUID(),
    localJobId = randomUUID();
  const localToken = randomUUID();
  const localHash = createHash('sha256').update(localToken).digest('hex');
  try {
    await docker(
      'exec',
      'irl-manager-installer-1',
      'sh',
      '-c',
      'umask 077; mkdir -p "$1/local-node"; printf "NODE_ID=%s\\nNODE_TOKEN=%s\\n" "$2" "$3" > "$1/local-node/.env"; echo keep > "$1/sibling"',
      'sh',
      localRoot,
      localNodeId,
      localToken,
    );
    await docker(
      'cp',
      'installer/uninstall.sh',
      `irl-manager-installer-1:${localRoot}/uninstall.sh`,
    );
    for (const phase of ['verify', 'apply']) {
      const output = await docker(
        'exec',
        '-e',
        `IRL_INSTALL_ROOT=${localRoot}/local-node`,
        'irl-manager-installer-1',
        'sh',
        `${localRoot}/uninstall.sh`,
        localNodeId,
        localHash,
        localJobId,
        phase,
        '1',
        'local',
      );
      assert.ok(output.includes(phase === 'verify' ? 'IRL_PROOF:files' : 'IRL_REMOVED'));
    }
    assert.equal(
      await docker(
        'exec',
        'irl-manager-installer-1',
        'sh',
        '-c',
        'test ! -e "$1/local-node" && cat "$1/sibling"',
        'sh',
        localRoot,
      ),
      'keep',
    );
    console.log('PASS local uninstall deletes only its verified installation directory');
  } finally {
    await docker('exec', 'irl-manager-installer-1', 'rm', '-rf', localRoot);
  }
  console.log(
    'PASS irreversible confirmation, role checks, ownership protection, remote-first cleanup, active-stream shutdown, unrelated-resource preservation, and retryable database cleanup',
  );
} finally {
  await browser?.close();
  if (blocked) await sql.unsafe(`DROP TABLE IF EXISTS "${block}"`).catch(() => {});
  // Every object below was created by this guarded, disposable fixture.
  if (ownsNamespace) {
    for (const name of ['irl-node-worker-1', 'irl-node-media-1', 'irl-node-srtla-1'])
      await docker('rm', '-f', name).catch(() => {});
    await docker('volume', 'rm', 'irl-manager-node-identity').catch(() => {});
    await docker('volume', 'rm', nodeVolume).catch(() => {});
    await docker('network', 'rm', 'irl-node_default').catch(() => {});
  }
  for (const name of [sentinel, sink, target]) await docker('rm', '-f', name).catch(() => {});
  await docker('volume', 'rm', otherVolume).catch(() => {});
  await docker('image', 'rm', `irl-remove-ssh-image:${suffix}`).catch(() => {});
  await rm(root, { recursive: true, force: true });
  if (managed) {
    // Preserve the reusable API fixture if a check fails before the final deletion.
    await db
      .update(channel)
      .set({ serverId: fixture.server.id, desired: 'stopped', state: 'offline' })
      .where(eq(channel.serverId, managed.nodeId));
    const { deleteNodeData } = await import('../src/lib/nodes/removal');
    await deleteNodeData(managed.nodeId, fixture.workspaces[0]);
  }
  await sql.end();
}
