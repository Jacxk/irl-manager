import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const f = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_admin_verify'));
const received = Promise.withResolvers<void>(),
  closed = Promise.withResolvers<void>();
let validAuth = true;
const upstream = createServer((req, res) => {
  validAuth &&=
    req.headers.authorization ===
    `Basic ${Buffer.from(`worker:${process.env.MEDIA_WORKER_TOKEN}`).toString('base64')}`;
  if (req.url?.endsWith('/slow.ts')) {
    res.on('close', () => {
      if (!res.writableEnded) closed.resolve();
    });
    received.resolve();
    return;
  }
  if (req.url?.endsWith('/index.m3u8')) {
    res
      .writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' })
      .end('#EXTM3U\nsegment.ts?user=worker&pass=private-test-token\n');
    return;
  }
  res.writeHead(200, { 'content-type': 'video/mp2t' }).end('sample-video-bytes');
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const address = upstream.address();
assert.ok(address && typeof address !== 'string');
const port = 3150,
  base = `http://localhost:${port}`;
const app = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--port', String(port)],
  {
    env: {
      ...process.env,
      BETTER_AUTH_URL: base,
      MEDIA_SERVER_ID: f.server.id,
      MEDIA_HLS_URL: `http://127.0.0.1:${address.port}`,
    },
    stdio: 'ignore',
  },
);
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    assert.equal(app.exitCode, null, 'Isolated app exited during startup');
    try {
      ready = (await fetch(base + '/login')).ok;
    } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'Isolated production app must become ready');
  const path = `${base}/api/preview/${f.channel.id}/`,
    headers = { Cookie: f.owner.cookie };
  const playlist = await fetch(path + 'index.m3u8', { headers });
  assert.equal(playlist.status, 200);
  const manifest = await playlist.text();
  assert.ok(manifest.includes('#EXTM3U'));
  assert.ok(!manifest.includes('private-test-token'));
  assert.ok(!manifest.includes('?user='));
  const segment = await fetch(path + 'segment.ts', { headers });
  assert.equal(segment.status, 200);
  assert.equal(await segment.text(), 'sample-video-bytes');
  const controller = new AbortController();
  const pending = fetch(path + 'slow.ts', { headers, signal: controller.signal }).catch(() => null);
  assert.equal(
    await Promise.race([received.promise.then(() => true), delay(2000).then(() => false)]),
    true,
    'Proxy must reach isolated upstream',
  );
  controller.abort();
  await pending;
  assert.equal(
    await Promise.race([closed.promise.then(() => true), delay(1500).then(() => false)]),
    true,
    'Client disconnect must cancel upstream promptly',
  );
  assert.ok(validAuth, 'Upstream worker authentication must be preserved');
  console.log(
    'PASS legacy preview bytes, credential stripping, worker authentication and upstream cancellation',
  );
} finally {
  app.kill('SIGTERM');
  const exited = await Promise.race([
    once(app, 'exit').then(() => true),
    delay(3000).then(() => false),
  ]);
  if (!exited) app.kill('SIGKILL');
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
}
