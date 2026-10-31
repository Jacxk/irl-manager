import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { destination } from '../src/lib/db/schema';
const fixture = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
async function command(action: string, more: Record<string, unknown> = {}) {
  const res = await fetch(base + '/api/control', {
    method: 'POST',
    headers: { Origin: base, Cookie: fixture.owner.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, channelId: fixture.channel.id, ...more }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}
async function state() {
  return (
    await (await fetch(base + '/api/control', { headers: { Cookie: fixture.owner.cookie } })).json()
  ).channels.find((c: { id: string }) => c.id === fixture.channel.id);
}
async function paths() {
  return (await (await fetch('http://localhost:9998/v3/paths/list')).json()).items.filter(
    (p: { ready: boolean }) => p.ready,
  );
}
async function until(label: string, test: () => Promise<boolean>, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) {
      console.log('PASS ' + label);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Timed out: ' + label + ' ' + JSON.stringify(await state()));
}
let encoder: ReturnType<typeof spawn> | undefined;
try {
  await db
    .update(destination)
    .set({ url: 'rtmp://irl-installer-sink:1935/live' })
    .where(eq(destination.channelId, fixture.channel.id));
  await command('scene', {
    title: 'Remote reconnect',
    subtitle: 'We will be back',
    color: '#101820',
    graceSeconds: 90,
  });
  await command('start');
  await until(
    'remote agent delivers simultaneous provider outputs without database credentials',
    async () => (await paths()).length === 2,
  );
  const { host, path, username, key } = fixture.credentials;
  encoder = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=sample_rate=48000',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-g',
      '60',
      '-c:a',
      'aac',
      '-f',
      'flv',
      `rtmp://${host}:1935/${path}?user=${username}&pass=${key}`,
    ],
    { stdio: 'ignore' },
  );
  await until(
    'remote stream health reports live through the control API',
    async () => (await state()).state === 'live',
  );
  const url = `${base}/api/preview/${fixture.channel.id}/`;
  const headers = { Cookie: fixture.owner.cookie };
  const master = await fetch(url + 'index.m3u8', { headers });
  assert.equal(master.status, 200, await master.clone().text());
  const variant = (await master.text()).split('\n').find((l) => l && !l.startsWith('#'));
  assert.ok(variant);
  const playlist = await fetch(url + variant, { headers });
  assert.equal(playlist.status, 200);
  const segment = (await playlist.text())
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .at(-1);
  assert.ok(segment);
  const media = await fetch(url + segment, { headers });
  assert.equal(media.status, 200, await media.clone().text());
  assert.ok((await media.arrayBuffer()).byteLength > 188);
  console.log(
    'PASS outbound-only authenticated remote preview returns playlists and actual video bytes',
  );
  const before = await paths();
  encoder.kill('SIGTERM');
  encoder = undefined;
  await until(
    'remote disconnect switches to fallback while both provider connections stay open',
    async () => (await state()).state === 'fallback' && (await paths()).length === 2,
  );
  const after = await paths();
  for (const p of before)
    assert.equal(after.find((n: { name: string }) => n.name === p.name).source.id, p.source.id);
  await command('stop');
  await until(
    'remote End stream disconnects every provider',
    async () => (await state()).state === 'ended' && (await paths()).length === 0,
  );
  await command('scene', {
    title: 'Remote reconnect',
    subtitle: 'We will be back',
    color: '#101820',
    graceSeconds: 15,
  });
  await command('start');
  await until(
    'remote session auto-ends after its reconnect window',
    async () => (await state()).endReason === 'timeout' && (await paths()).length === 0,
    35000,
  );
} finally {
  encoder?.kill('SIGTERM');
  await command('stop').catch(() => {});
  await sql.end();
}
