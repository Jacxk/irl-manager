import 'dotenv/config';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const fixture = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
async function command(action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, Cookie: fixture.owner.cookie },
    body: JSON.stringify({ action, channelId: fixture.channel.id, ...extra }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return res.json();
}
async function snapshot() {
  const res = await fetch(`${base}/api/control`, { headers: { Cookie: fixture.owner.cookie } });
  assert.equal(res.status, 200);
  return res.json();
}
async function until(label: string, condition: () => Promise<boolean>, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      console.log(`PASS ${label}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const state = await snapshot();
  console.error(
    JSON.stringify({
      channels: state.channels.map((c: { state: string; endReason: string }) => ({
        state: c.state,
        endReason: c.endReason,
      })),
      destinations: state.destinations.map((d: { status: string; lastError: string }) => ({
        status: d.status,
        error: d.lastError,
      })),
    }),
  );
  throw new Error(`Timed out: ${label}`);
}
type SinkPath = {
  name: string;
  ready: boolean;
  readyTime: string;
  bytesReceived: number;
  source: { id: string };
};
async function sinkPaths(): Promise<SinkPath[]> {
  const res = await fetch('http://localhost:9998/v3/paths/list');
  assert.equal(res.status, 200);
  return (await res.json()).items.filter((p: SinkPath) => p.ready);
}
async function sinkCount() {
  return (await sinkPaths()).length;
}
function startEncoder(protocol: 'rtmp' | 'srt') {
  const { host, path, username, key } = fixture.credentials;
  const url =
    protocol === 'rtmp'
      ? `rtmp://${host}:1935/${path}?user=${username}&pass=${key}`
      : `srt://media:8890?streamid=publish:${path}:${username}:${key}&pkt_size=1316`;
  const args = [
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
    'sine=frequency=440:sample_rate=48000',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-g',
    '60',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-f',
    protocol === 'rtmp' ? 'flv' : 'mpegts',
    url,
  ];
  if (protocol === 'srt') {
    encoderContainer = `irl-manager-test-encoder-${fixture.channel.id}`;
    return spawn(
      'docker',
      [
        'compose',
        '-f',
        'compose.yml',
        '-f',
        'infra/dev.yml',
        '-f',
        'infra/media-test.yml',
        'run',
        '--rm',
        '--no-deps',
        '--name',
        encoderContainer,
        'worker',
        'ffmpeg',
        ...args,
      ],
      { stdio: 'ignore' },
    );
  }
  return spawn('ffmpeg', args, { stdio: 'ignore' });
}

let encoder: ReturnType<typeof spawn> | undefined;
let encoderContainer: string | undefined;
async function stopEncoder() {
  if (encoderContainer)
    await execFileAsync('docker', ['stop', '-t', '2', encoderContainer]).catch(() => {});
  encoder?.kill('SIGTERM');
  encoder = undefined;
  encoderContainer = undefined;
}
try {
  await command('scene', {
    title: 'Connection lost',
    subtitle: 'Back shortly',
    color: '#101820',
    graceSeconds: 120,
  });
  await command('start');
  await until(
    'simultaneous relays deliver fallback to two independent endpoints',
    async () => (await sinkCount()) === 2,
  );
  const originalSinks = await sinkPaths();
  encoder = startEncoder('rtmp');
  await until('live input recovers through stability window', async () => {
    const s = await snapshot();
    return s.channels[0].state === 'live';
  });
  const preview = await fetch(`${base}/api/preview/${fixture.channel.id}/index.m3u8`, {
    headers: { Cookie: fixture.owner.cookie },
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const master = await preview.text();
  assert.ok(master.includes('#EXTM3U'));
  const variant = master.split('\n').find((line) => line.trim() && !line.startsWith('#'));
  assert.ok(variant);
  const playlist = await fetch(`${base}/api/preview/${fixture.channel.id}/${variant}`, {
    headers: { Cookie: fixture.owner.cookie },
  });
  assert.equal(playlist.status, 200);
  const mediaPlaylist = await playlist.text();
  const segment = mediaPlaylist
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .at(-1);
  assert.ok(segment);
  const video = await fetch(`${base}/api/preview/${fixture.channel.id}/${segment}`, {
    headers: { Cookie: fixture.owner.cookie },
  });
  assert.equal(video.status, 200);
  assert.ok((await video.arrayBuffer()).byteLength > 188);
  assert.equal((await fetch(`${base}/api/preview/${fixture.channel.id}/index.m3u8`)).status, 401);
  console.log('PASS authenticated playlists and video segments; anonymous preview denied');
  await stopEncoder();
  await until('dropped encoder selects fallback without disconnecting providers', async () => {
    const s = await snapshot();
    return s.channels[0].state === 'fallback' && (await sinkCount()) === 2;
  });
  const fallbackSinks = await sinkPaths();
  for (const original of originalSinks) {
    const current = fallbackSinks.find((p) => p.name === original.name)!;
    assert.equal(
      current.source.id,
      original.source.id,
      'Live/fallback switches must preserve provider connections',
    );
    assert.ok(current.bytesReceived > original.bytesReceived, 'Media must continue arriving');
  }
  console.log(
    'PASS provider connection IDs persist and media bytes advance through scene switches',
  );
  encoder = startEncoder('srt');
  await until(
    'SRT ingest reconnects and restores live',
    async () => (await snapshot()).channels[0].state === 'live',
  );
  await command('fallback', { enabled: true });
  await until(
    'operator can force fallback while input remains live',
    async () => (await snapshot()).channels[0].state === 'fallback',
  );
  await command('fallback', { enabled: false });
  await until(
    'automatic live selection resumes',
    async () => (await snapshot()).channels[0].state === 'live',
  );
  const beforeFailure = await sinkPaths();
  const first = beforeFailure.find((p) => p.name === 'live/stream-one')!;
  const second = beforeFailure.find((p) => p.name === 'live/stream-two')!;
  const kicked = await fetch(`http://localhost:9998/v3/rtmpconns/kick/${first.source.id}`, {
    method: 'POST',
  });
  assert.equal(kicked.status, 200);
  await until(
    'failed provider reconnects independently while the other stays connected',
    async () => {
      const paths = await sinkPaths();
      return (
        paths.length === 2 &&
        paths.find((p) => p.name === first.name)?.source.id !== first.source.id &&
        paths.find((p) => p.name === second.name)?.source.id === second.source.id
      );
    },
  );
  await command('stop');
  await until('intentional end disconnects all providers', async () => {
    const s = await snapshot();
    return (
      s.channels[0].state === 'ended' &&
      s.channels[0].endReason === 'intentional' &&
      (await sinkCount()) === 0
    );
  });
  await stopEncoder();
  await command('scene', {
    title: 'Connection lost',
    subtitle: 'Back shortly',
    color: '#101820',
    graceSeconds: 15,
  });
  await command('start');
  await until('new session starts all enabled destinations', async () => (await sinkCount()) === 2);
  await until(
    'expired grace period ends every destination',
    async () => {
      const s = await snapshot();
      return (
        s.channels[0].state === 'ended' &&
        s.channels[0].endReason === 'timeout' &&
        (await sinkCount()) === 0
      );
    },
    30000,
  );
} finally {
  await stopEncoder();
  await command('stop').catch(() => {});
}
