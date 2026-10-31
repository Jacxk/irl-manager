import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { channel, destination, event, mediaServer } from '../src/lib/db/schema';
import { decrypt } from '../src/lib/crypto';
import { nextHealth, retryDelay } from '../src/lib/lifecycle';
const serverId = process.env.MEDIA_SERVER_ID;
const token = process.env.MEDIA_WORKER_TOKEN;
if (!serverId || !token)
  throw new Error('Set MEDIA_SERVER_ID and MEDIA_WORKER_TOKEN before starting the worker.');
const host = process.env.MEDIA_INTERNAL_HOST ?? 'localhost';
const rtsp = (path: string) => `rtsp://worker:${encodeURIComponent(token)}@${host}:8554/${path}`;
const rtmp = (path: string) =>
  `rtmp://${host}:1935/${path}?user=worker&pass=${encodeURIComponent(token)}`;
type Relay = {
  process?: ChildProcess;
  nextRetry: number;
  attempts: number;
  stopping: boolean;
  connected: boolean;
};
type Program = {
  process: ChildProcess;
  sessionId: string;
  lastFrame: number;
  stableSince: number | null;
  lastTelemetry: number;
  state: string;
  manual: boolean;
  stopping: boolean;
  relays: Map<string, Relay>;
};
const programs = new Map<string, Program>();
let exiting = false;
async function log(c: typeof channel.$inferSelect, kind: string, message: string) {
  await db
    .insert(event)
    .values({ id: randomUUID(), channelId: c.id, sessionId: c.sessionId, kind, message });
}
function terminate(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 3000);
  timer.unref();
}
function startProgram(c: typeof channel.$inferSelect): Program {
  const child = spawn(process.env.PYTHON_BIN ?? 'python3', ['-u', 'worker/program.py'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const p: Program = {
    process: child,
    sessionId: c.sessionId!,
    lastFrame: c.lastFrameAt?.getTime() ?? 0,
    stableSince: null,
    lastTelemetry: Date.now(),
    state: 'starting',
    manual: c.manualFallback,
    stopping: false,
    relays: new Map(),
  };
  child.stdin!.on('error', () => {});
  // Pipeline credentials travel over stdin, never command-line arguments or logs.
  child.stdin!.write(
    JSON.stringify({
      input: rtsp(`input_${c.id}`),
      output: rtmp(`program_${c.id}`),
      title: c.sceneTitle,
      subtitle: c.sceneSubtitle,
      color: c.sceneColor,
      manual: c.manualFallback,
    }) + '\n',
  );
  child.stderr!.on('data', (chunk: Buffer) => {
    if (process.env.MEDIA_DEBUG === '1')
      console.error(
        'Program:',
        chunk
          .toString()
          .replace(/(?:rtmps?|rtsp):\/\/\S+/g, '[redacted]')
          .replaceAll(token!, '[redacted]'),
      );
  });
  createInterface({ input: child.stdout! }).on('line', (line) => {
    try {
      const health = JSON.parse(line);
      if (process.env.MEDIA_DEBUG === '1' && health.type !== 'health')
        console.log('Program event', JSON.stringify(health));
      if (health.type === 'health') {
        if (process.env.MEDIA_DEBUG === '1') console.log('Health', JSON.stringify(health));
        p.lastTelemetry = Date.now();
        if (health.lastFrameAgeMs !== null) p.lastFrame = Date.now() - health.lastFrameAgeMs;
        p.stableSince = health.stableForMs > 0 ? Date.now() - health.stableForMs : null;
      }
    } catch {
      /* Ignore non-protocol output. */
    }
  });
  child.on('error', () => {
    p.lastTelemetry = 0;
  });
  child.on('exit', () => {
    p.lastTelemetry = 0;
  });
  return p;
}
async function stopProgram(c: typeof channel.$inferSelect, p: Program, reason: string) {
  p.stopping = true;
  for (const relay of p.relays.values()) {
    relay.stopping = true;
    terminate(relay.process);
  }
  p.process.stdin?.write(JSON.stringify({ action: 'stop' }) + '\n');
  terminate(p.process);
  programs.delete(c.id);
  await db.transaction(async (tx) => {
    await tx
      .update(destination)
      .set({ status: 'idle', lastError: null, updatedAt: new Date() })
      .where(eq(destination.channelId, c.id));
    await tx
      .update(channel)
      .set({
        desired: 'stopped',
        state: 'ended',
        endedAt: new Date(),
        endReason: reason,
        manualFallback: false,
      })
      .where(and(eq(channel.id, c.id), eq(channel.sessionId, p.sessionId)));
  });
  await log(
    c,
    'session',
    reason === 'intentional'
      ? 'Broadcast ended by operator. All outputs disconnected.'
      : reason === 'timeout'
        ? 'Reconnect window expired. All outputs disconnected.'
        : 'Media pipeline stopped. All outputs disconnected.',
  );
}
async function startRelay(
  c: typeof channel.$inferSelect,
  p: Program,
  d: typeof destination.$inferSelect,
  relay: Relay,
) {
  relay.stopping = false;
  relay.connected = false;
  const output = `${d.url.replace(/\/$/, '')}/${decrypt(d.encryptedKey)}`;
  // Spawn without a shell. Output destinations are independent processes.
  // FFmpeg requires an output URL argument; stderr is discarded to avoid credential exposure.
  const child = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-rtsp_transport',
      'tcp',
      '-timeout',
      '10000000',
      '-i',
      rtsp(`program_${c.id}`),
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c',
      'copy',
      '-f',
      'flv',
      '-rw_timeout',
      '10000000',
      '-progress',
      'pipe:1',
      output,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  relay.process = child;
  await db
    .update(destination)
    .set({ status: 'connecting', lastError: null, updatedAt: new Date() })
    .where(eq(destination.id, d.id));
  child.stderr!.resume();
  let failed = false;
  const failure = () => {
    if (failed) return;
    failed = true;
    relay.process = undefined;
    if (relay.stopping || p.stopping || exiting) return;
    relay.attempts++;
    relay.nextRetry = Date.now() + retryDelay(relay.attempts - 1);
    void db
      .update(destination)
      .set({
        status: 'retrying',
        retries: relay.attempts,
        lastError: 'Connection interrupted. Retrying independently.',
        updatedAt: new Date(),
      })
      .where(eq(destination.id, d.id))
      .catch(() => {});
  };
  child.on('error', failure);
  child.on('exit', failure);
  createInterface({ input: child.stdout! }).on('line', (line) => {
    if (!relay.connected && /^out_time_us=[1-9]/.test(line) && !relay.stopping && !p.stopping) {
      relay.connected = true;
      void db
        .update(destination)
        .set({ status: 'connected', lastError: null, updatedAt: new Date() })
        .where(eq(destination.id, d.id))
        .catch(() => {});
    }
  });
}
async function reconcile() {
  await db
    .update(mediaServer)
    .set({ heartbeatAt: new Date() })
    .where(eq(mediaServer.id, serverId!));
  const channels = await db.select().from(channel).where(eq(channel.serverId, serverId!));
  for (const c of channels) {
    let p = programs.get(c.id);
    if (p && (c.desired !== 'running' || c.sessionId !== p.sessionId)) {
      await stopProgram(c, p, c.endReason ?? 'intentional');
      p = undefined;
    }
    if (c.desired !== 'running') {
      if (c.state === 'ending')
        await db
          .update(channel)
          .set({ state: 'ended', endedAt: new Date() })
          .where(eq(channel.id, c.id));
      continue;
    }
    if (!p) {
      p = startProgram(c);
      programs.set(c.id, p);
      await log(c, 'session', 'Media program started. Connecting enabled destinations.');
    }
    if (Date.now() - p.lastTelemetry > 15000) {
      await stopProgram(c, p, 'worker_error');
      continue;
    }
    if (p.manual !== c.manualFallback) {
      p.manual = c.manualFallback;
      p.process.stdin?.write(JSON.stringify({ action: 'fallback', enabled: p.manual }) + '\n');
    }
    const state = nextHealth({
      desired: c.desired,
      manual: c.manualFallback,
      now: Date.now(),
      lastFrame: p.lastFrame,
      stableSince: p.stableSince,
      started: c.startedAt!.getTime(),
      graceSeconds: c.graceSeconds,
    });
    if (state === 'ended') {
      await stopProgram(c, p, 'timeout');
      continue;
    }
    if (state !== p.state) {
      p.state = state;
      await log(
        c,
        'health',
        state === 'live'
          ? 'Input stable. Live scene restored.'
          : state === 'fallback'
            ? 'Fallback scene active. Destinations remain connected.'
            : state === 'degraded'
              ? 'Input is unstable. Monitoring recovery.'
              : 'Input detected. Waiting for a stable connection.',
      );
    }
    await db
      .update(channel)
      .set({ state, lastFrameAt: p.lastFrame ? new Date(p.lastFrame) : null })
      .where(
        and(
          eq(channel.id, c.id),
          eq(channel.sessionId, p.sessionId),
          eq(channel.desired, 'running'),
        ),
      );
    const targets = await db.select().from(destination).where(eq(destination.channelId, c.id));
    for (const d of targets) {
      let relay = p.relays.get(d.id);
      if (!d.enabled) {
        if (relay) {
          relay.stopping = true;
          terminate(relay.process);
          p.relays.delete(d.id);
          await db
            .update(destination)
            .set({ status: 'idle', updatedAt: new Date() })
            .where(eq(destination.id, d.id));
        }
        continue;
      }
      if (!relay) {
        relay = { nextRetry: 0, attempts: 0, stopping: false, connected: false };
        p.relays.set(d.id, relay);
      }
      if (!relay.process && Date.now() >= relay.nextRetry) await startRelay(c, p, d, relay);
    }
  }
}
// A dedicated connection holds a server-scoped lock for the worker lifetime.
const lock = await sql.reserve();
const [held] = await lock`select pg_try_advisory_lock(hashtext(${serverId})) as locked`;
if (!held.locked) throw new Error('Another worker already owns this media node.');
if (!(await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, serverId) })))
  throw new Error('Add this media node in the dashboard first.');
console.log('Media worker connected. Reconciling desired session state.');
async function shutdown() {
  if (exiting) return;
  exiting = true;
  for (const p of programs.values()) {
    p.stopping = true;
    for (const r of p.relays.values()) {
      r.stopping = true;
      terminate(r.process);
    }
    terminate(p.process);
  }
  await db.update(mediaServer).set({ heartbeatAt: null }).where(eq(mediaServer.id, serverId!));
  lock.release();
  await sql.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
while (!exiting) {
  try {
    await reconcile();
  } catch {
    console.error('Reconciliation failed. Check database and media configuration.');
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
