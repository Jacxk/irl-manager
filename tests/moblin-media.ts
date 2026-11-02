import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from '../src/lib/db';
const exec = promisify(execFile);
export async function runMoblinMedia(f: {
  nodeId: string;
  channelId: string;
  nodeToken: string;
  live: (value: boolean) => void;
  bitrate: (kbps: number) => void;
  disconnect: () => void;
  reconnect: () => Promise<void>;
}) {
  const suffix = randomUUID().slice(0, 8),
    network = `irl-moblin-verify-${suffix}`;
  const names = {
    media: `${network}-media`,
    worker: `${network}-worker`,
    sink: `${network}-sink`,
    encoder: `${network}-encoder`,
  };
  const dir = mkdtempSync(join(tmpdir(), 'irl-moblin-media-'));
  const image = process.env.TEST_MOBLIN_WORKER_IMAGE ?? 'irl-moblin-verify-worker';
  async function docker(args: string[], timeout = 15000) {
    try {
      return (await exec('docker', args, { timeout, maxBuffer: 1024 * 1024 })).stdout.trim();
    } catch {
      throw new Error(`Isolated Docker media command failed (${args[0]}).`);
    }
  }
  async function until(label: string, check: () => Promise<boolean>, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await delay(500);
    }
    throw new Error(`Media verification timed out: ${label}`);
  }
  async function c() {
    return (
      await sql`select desired,state,"sessionId","endReason" from channel where id=${f.channelId}`
    )[0];
  }
  async function sample(source = 'program') {
    const code = `const {spawnSync}=require('node:child_process');const r=spawnSync('ffmpeg',['-nostdin','-loglevel','error','-rtsp_transport','tcp','-i','rtsp://worker:'+process.env.MEDIA_WORKER_TOKEN+'@media:8554/${source}_${f.channelId}','-vf','crop=2:2:40:40','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{timeout:15000});if(r.status!==0)process.exit(1);console.log(JSON.stringify([...r.stdout.subarray(0,3)]));`;
    return JSON.parse(await docker(['exec', names.worker, 'node', '-e', code], 18000)) as number[];
  }
  async function sinks() {
    const code =
      "fetch('http://sink:9997/v3/paths/list').then(r=>r.json()).then(d=>console.log(JSON.stringify(d.items.filter(p=>p.ready).map(p=>({id:p.source.id,bytes:p.bytesReceived}))))).catch(()=>process.exit(1))";
    return JSON.parse(await docker(['exec', names.worker, 'node', '-e', code])) as {
      id: string;
      bytes: number;
    }[];
  }
  try {
    writeFileSync(
      join(dir, '.env'),
      `NODE_ID=${f.nodeId}\nNODE_TOKEN=${f.nodeToken}\nMEDIA_WORKER_TOKEN=${f.nodeToken}\nMEDIA_INTERNAL_HOST=media\nCONTROL_URL=http://host.docker.internal:3160\nALLOW_INSECURE_NODE_CONTROL=1\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      join(dir, 'sink.yml'),
      'api: true\napiAddress: :9997\nauthInternalUsers:\n  - user: any\n    permissions:\n      - action: publish\n      - action: read\n      - action: api\npaths:\n  all_others:\n    source: publisher\n',
    );
    await docker(['network', 'create', network]);
    await docker([
      'create',
      '--name',
      names.media,
      '--network',
      network,
      '--network-alias',
      'media',
      '-e',
      'MTX_AUTHHTTPADDRESS=http://worker:9000/auth',
      'bluenviron/mediamtx:1.15.6',
    ]);
    await docker(['cp', 'infra/mediamtx.yml', `${names.media}:/mediamtx.yml`]);
    await docker([
      'create',
      '--name',
      names.sink,
      '--network',
      network,
      '--network-alias',
      'sink',
      'bluenviron/mediamtx:1.15.6',
    ]);
    await docker(['cp', join(dir, 'sink.yml'), `${names.sink}:/mediamtx.yml`]);
    await docker([
      'create',
      '--name',
      names.worker,
      '--network',
      network,
      '--network-alias',
      'worker',
      '--add-host',
      'host.docker.internal:host-gateway',
      '--env-file',
      join(dir, '.env'),
      image,
    ]);
    await sql`update media_server set "agentInstance"=null,"agentLeaseAt"=null,"heartbeatAt"=null where id=${f.nodeId}`;
    await sql`update destination set url='rtmp://sink:1935/live' where "channelId"=${f.channelId}`;
    await docker(['start', names.media, names.sink, names.worker]);
    await until('real worker heartbeat', async () => {
      const r = (await sql`select "heartbeatAt" from media_server where id=${f.nodeId}`)[0];
      return !!r.heartbeatAt && Date.now() - new Date(r.heartbeatAt).getTime() < 5000;
    });
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:size=1280x720:rate=30',
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
      'flv',
      `rtmp://media:1935/input_${f.channelId}?user=${f.channelId}&pass=fixture-ingest-key`,
    ];
    await docker([
      'run',
      '-d',
      '--name',
      names.encoder,
      '--network',
      network,
      '--entrypoint',
      'ffmpeg',
      image,
      ...args,
    ]);
    // A phone stream creates a protected preview while destination control is off.
    await sql`update moblin_pairing set "syncBroadcast"=false where "channelId"=${f.channelId}`;
    f.live(false);
    await delay(100);
    f.live(true);
    async function previewRow() {
      return (
        await sql`select "previewSessionId","previewState" from moblin_pairing where "channelId"=${f.channelId}`
      )[0];
    }
    await until(
      'pre-live protected preview',
      async () => (await previewRow()).previewState === 'live',
    );
    const previewSession = (await previewRow()).previewSessionId;
    assert.equal((await c()).desired, 'stopped');
    assert.equal((await sinks()).length, 0);
    const previewRed = await sample('preview');
    assert.ok(previewRed[0] > 180 && previewRed[1] < 80);
    f.disconnect();
    await docker(['stop', '-t', '1', names.encoder]);
    await until(
      'pre-live network loss BRB',
      async () => (await previewRow()).previewState === 'fallback',
    );
    await delay(10000);
    const previewBrb = await sample('preview');
    assert.ok(
      previewBrb.every((v) => v < 100),
      'Protected preview did not render BRB',
    );
    assert.equal((await previewRow()).previewSessionId, previewSession);
    assert.equal((await c()).desired, 'stopped');
    assert.equal((await sinks()).length, 0);
    await docker(['start', names.encoder]);
    await f.reconnect();
    f.live(true);
    await until('pre-live recovery', async () => (await previewRow()).previewState === 'live');
    assert.equal((await previewRow()).previewSessionId, previewSession);
    f.live(false);
    await until(
      'explicit Stop closes protected preview',
      async () => !(await previewRow()).previewSessionId,
    );
    await delay(1500);
    assert.equal((await c()).desired, 'stopped');
    assert.equal((await sinks()).length, 0);
    // Continue existing destination-broadcast regression coverage.
    await sql`update moblin_pairing set "syncBroadcast"=true where "channelId"=${f.channelId}`;
    f.live(true);
    await until('phone starts actual broadcast', async () => (await c()).state === 'live');
    const session = (await c()).sessionId;
    await until('private sink connected', async () => (await sinks()).length === 1);
    const before = (await sinks())[0];
    const red = await sample();
    assert.ok(red[0] > 180 && red[1] < 80 && red[2] < 80, 'Program did not show live input');
    f.bitrate(100);
    await delay(2100);
    f.bitrate(100);
    await until('bitrate BRB', async () => (await c()).state === 'fallback');
    const brb = await sample();
    assert.ok(
      brb[0] < 100 && brb[1] < 100 && brb[2] < 100,
      'Program did not switch to the BRB background',
    );
    const during = (await sinks())[0];
    assert.equal(during.id, before.id);
    assert.ok(during.bytes > before.bytes);
    f.bitrate(1000);
    await delay(2100);
    f.bitrate(1000);
    await until('bitrate recovery', async () => (await c()).state === 'live');
    await docker(['stop', '-t', '1', names.encoder]);
    await until('encoder loss BRB', async () => (await c()).state === 'fallback');
    await delay(10000);
    assert.equal((await c()).desired, 'running');
    assert.equal((await c()).sessionId, session);
    assert.equal((await sinks())[0].id, before.id);
    await docker(['start', names.encoder]);
    await until('encoder recovery preserves session', async () => (await c()).state === 'live');
    assert.equal((await c()).sessionId, session);
    f.live(false);
    await until(
      'explicit phone Stop ends all output',
      async () => (await c()).state === 'ended' && (await sinks()).length === 0,
    );
    assert.equal((await c()).endReason, 'intentional');
    console.log(
      'Real media: native phone Go live started sink output; low bitrate selected BRB pixels without reconnecting the sink; 10-second encoder loss recovered in the same session; explicit phone Stop closed output.',
    );
  } finally {
    for (const name of Object.values(names))
      await exec('docker', ['rm', '-f', name], { timeout: 10000 }).catch(() => {});
    await exec('docker', ['network', 'rm', network], { timeout: 10000 }).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}
