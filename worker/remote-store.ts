import { publishIdentity } from '../src/lib/ingest';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import type { Store, ChannelRow, DestinationRow } from './store';
export async function remoteStore(nodeId: string): Promise<Store> {
  const base = new URL(process.env.CONTROL_URL!);
  if (base.protocol !== 'https:' && process.env.ALLOW_INSECURE_NODE_CONTROL !== '1')
    throw new Error('CONTROL_URL must use HTTPS.');
  const token = process.env.NODE_TOKEN!;
  if (!token) throw new Error('NODE_TOKEN is required.');
  const instance = randomUUID();
  let channels: ChannelRow[] = [];
  let changes: Record<string, unknown>[] = [];
  let lastContact = Date.now();
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-node-id': nodeId,
    'x-node-instance': instance,
  };
  const previews = new Set<string>();
  async function call(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, base), {
      ...init,
      headers: { ...headers, ...init.headers },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Control API returned ${response.status}.`);
    lastContact = Date.now();
    return response;
  }
  function equal(a: string, b: string) {
    const x = Buffer.from(a),
      y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
  // MediaMTX only calls this on the private container network. No public port.
  const auth = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/auth') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) {
        res.writeHead(413).end();
        return;
      }
    }
    try {
      const input = JSON.parse(body);
      const publisher = publishIdentity(input);
      const c = publisher
        ? channels.find((c) => publisher.path === `input_${c.id}`)
        : undefined;
      const allowed =
        Date.now() - lastContact < 30000 &&
        ((input.user === 'worker' &&
          equal(String(input.password ?? ''), process.env.MEDIA_WORKER_TOKEN ?? token)) ||
          (!!publisher &&
            !!c &&
            publisher.user === c.id &&
            equal(publisher.password, c.ingestKey)));
      res.writeHead(allowed ? 200 : 401).end();
    } catch {
      res.writeHead(401).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    auth.once('error', reject);
    auth.listen(Number(process.env.NODE_AUTH_PORT ?? 9000), '0.0.0.0', resolve);
  });
  async function ready() {
    return new Promise<boolean>((resolve) => {
      const socket = connect({ host: process.env.MEDIA_INTERNAL_HOST ?? 'media', port: 8554 });
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }
  async function preview(ticket: { id: string; path: string }) {
    if (
      previews.has(ticket.id) ||
      previews.size >= 8 ||
      !/^(?:program|input|preview)_[0-9a-f-]+\/[-a-zA-Z0-9_.]+$/.test(ticket.path)
    )
      return;
    previews.add(ticket.id);
    try {
      const response = await fetch(
        `http://${process.env.MEDIA_INTERNAL_HOST ?? 'media'}:8888/${ticket.path}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`worker:${process.env.MEDIA_WORKER_TOKEN ?? token}`).toString('base64')}`,
          },
          signal: AbortSignal.timeout(12000),
        },
      );
      const parts: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader)
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 8 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('Preview too large.');
          }
          parts.push(next.value);
        }
      await call(`/api/nodes/agent/preview/${ticket.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
          'x-preview-status': String(
            [200, 400, 401, 404, 500, 502, 503].includes(response.status) ? response.status : 502,
          ),
        },
        body: Buffer.concat(parts),
      });
    } catch {
      await call(`/api/nodes/agent/preview/${ticket.id}`, {
        method: 'PUT',
        headers: { 'x-preview-status': '503' },
        body: 'Preview unavailable.',
      }).catch(() => {});
    } finally {
      previews.delete(ticket.id);
    }
  }
  return {
    async load() {
      const response = await call('/api/nodes/agent/config', {
        headers: { 'x-media-ready': (await ready()) ? '1' : '0' },
      });
      const data = await response.json();
      channels = data.channels.map((c: ChannelRow) => ({
        ...c,
        previewStartedAt: c.previewStartedAt ? new Date(c.previewStartedAt) : null,
        previewLastFrameAt: c.previewLastFrameAt ? new Date(c.previewLastFrameAt) : null,
        startedAt: c.startedAt ? new Date(c.startedAt) : null,
        lastFrameAt: c.lastFrameAt ? new Date(c.lastFrameAt) : null,
      }));
      for (const ticket of data.previews) void preview(ticket);
      return { channels, destinations: data.destinations as DestinationRow[] };
    },
    async preview(c, previewSessionId, patch) {
      changes.push({
        type: 'preview',
        id: c.id,
        previewSessionId,
        state: patch.state,
        lastFrameAt: patch.lastFrameAt?.toISOString() ?? null,
        finished: patch.finished ?? false,
      });
    },
    async channel(c, patch) {
      changes.push({
        type: 'channel',
        receiveKbps: patch.receiveKbps,
        sendKbps: patch.sendKbps,
        telemetryAt: patch.telemetryAt?.toISOString(),
        id: c.id,
        sessionId: c.sessionId,
        state: patch.state,
        lastFrameAt:
          patch.lastFrameAt === undefined ? undefined : (patch.lastFrameAt?.toISOString() ?? null),
        endReason: patch.endReason ?? undefined,
      });
    },
    async destination(d, sessionId, patch) {
      changes.push({
        type: 'destination',
        id: d.id,
        channelId: d.channelId,
        sessionId,
        status: patch.status,
        retries: patch.retries,
        lastError: patch.lastError,
      });
    },
    async event(c, kind, message) {
      changes.push({
        type: 'event',
        id: randomUUID(),
        channelId: c.id,
        sessionId: c.sessionId,
        kind,
        message,
      });
    },
    async key(d) {
      if (!d.streamKey) throw new Error('Destination key missing.');
      return d.streamKey;
    },
    async flush() {
      if (!changes.length) return;
      const batch = changes.splice(0, 200);
      try {
        await call('/api/nodes/agent/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes: batch }),
        });
      } catch (e) {
        changes = [...batch, ...changes].slice(-500);
        throw e;
      }
    },
    async close() {
      auth.close();
    },
  };
}
