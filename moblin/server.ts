import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { db } from '../src/lib/db';
import { moblinPairing, serviceHeartbeat } from '../src/lib/db/schema';
import { decrypt } from '../src/lib/crypto';
import { readSettings } from '../src/lib/settings';
import { moblinAuthentication, verifyMoblinAuthentication } from '../src/lib/moblin/protocol';
import { claimMoblin, releaseMoblin, updateMoblin } from '../src/lib/moblin/service';

const record = z.record(z.string(), z.unknown());
const state = z.object({ streaming: z.boolean().optional() });
const status = z.object({
  topRight: z
    .object({
      bitrateInfo: z.object({ bitsPerSecond: z.number().int().min(0).max(1e12) }).nullish(),
    })
    .nullish(),
});
/** Dedicated WebSocket process: Next's HTTP route handlers do not own upgrades. */
export async function startMoblinGateway({
  port = Number(process.env.MOBLIN_PORT ?? 3001),
  host = process.env.MOBLIN_BIND ?? '127.0.0.1',
} = {}) {
  const server = createServer((_req, res) =>
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Moblin gateway\n'),
  );
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  const attempts = new Map<string, { at: number; count: number }>();
  let stopping = false;
  let pendingUpgrades = 0;
  server.on('upgrade', (request, socket, head) => {
    const ip = request.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    for (const [key, value] of attempts) if (now - value.at > 10000) attempts.delete(key);
    const attempt = attempts.get(ip) ?? { at: now, count: 0 };
    attempt.count++;
    attempts.set(ip, attempt);
    if (stopping || attempt.count > 10 || attempts.size > 10000 || pendingUpgrades >= 32) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return;
    }
    pendingUpgrades++;
    void (async () => {
      const { values } = await readSettings();
      const match = /^\/moblin\/([0-9a-f-]{36})$/.exec(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      if (
        stopping ||
        !values.allowMoblinControl ||
        !match ||
        attempt.count > 10 ||
        attempts.size > 10000 ||
        wss.clients.size >= values.maxMoblinConnections + 16 ||
        (request.headers.origin && request.headers.origin !== values.publicUrl)
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      const pairing = await db.query.moblinPairing.findFirst({
        where: eq(moblinPairing.channelId, match[1]),
      });
      if (!pairing?.enabled) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      const salt = randomBytes(24).toString('base64'),
        challenge = randomBytes(24).toString('base64');
      const expected = moblinAuthentication(decrypt(pairing.encryptedPassword), salt, challenge);
      wss.handleUpgrade(request, socket, head, (ws) => {
        const id = pairing.channelId,
          revision = pairing.revision;
        let connectionId: string | undefined;
        let authenticated = false,
          closed = false,
          alive = true,
          busy = false;
        let pending = 0,
          requestId = 0,
          messages = 0,
          windowAt = Date.now();
        let queue = Promise.resolve();
        const send = (value: unknown) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
        };
        const sendStatus = () => send({ request: { id: ++requestId, data: { getStatus: {} } } });
        const authTimeout = setTimeout(() => ws.close(1008, 'Authentication timed out'), 10000);
        ws.on('error', () => {});
        ws.on('pong', () => {
          alive = true;
        });
        send({ hello: { apiVersion: '0.1', authentication: { salt, challenge } } });
        const heartbeat = setInterval(() => {
          if (busy || !authenticated || !connectionId) return;
          if (!alive) {
            ws.terminate();
            return;
          }
          alive = false;
          ws.ping();
          busy = true;
          void updateMoblin(id, connectionId, revision)
            .then(() => {
              sendStatus();
            })
            .catch(() => ws.close(1008, 'Pairing or permission changed'))
            .finally(() => {
              busy = false;
            });
        }, 5000);
        ws.on('close', () => {
          closed = true;
          clearTimeout(authTimeout);
          clearInterval(heartbeat);
          // Also release after any in-flight authentication/state transaction completes.
          void queue.finally(() =>
            connectionId ? releaseMoblin(id, connectionId).catch(() => {}) : undefined,
          );
        });
        ws.on('message', (buffer, binary) => {
          if (binary || closed) {
            ws.close(1008, 'JSON messages required');
            return;
          }
          if (Date.now() - windowAt > 1000) {
            windowAt = Date.now();
            messages = 0;
          }
          if (++messages > 30 || ++pending > 50) {
            ws.close(1008, 'Message rate exceeded');
            return;
          }
          queue = queue
            .then(async () => {
              if (closed) return;
              const message = record.parse(JSON.parse(buffer.toString()));
              if (!authenticated) {
                const identify = z
                  .object({ authentication: z.string().max(128) })
                  .parse(message.identify);
                if (!verifyMoblinAuthentication(identify.authentication, expected)) {
                  send({ identified: { result: { wrongPassword: {} } } });
                  ws.close(1008, 'Invalid authentication');
                  return;
                }
                connectionId = await claimMoblin(id, revision);
                if (closed) {
                  await releaseMoblin(id, connectionId);
                  return;
                }
                authenticated = true;
                clearTimeout(authTimeout);
                send({ identified: { result: { ok: {} } } });
                send({
                  request: {
                    id: ++requestId,
                    data: { startStatus: { interval: 1, filter: { topRight: true } } },
                  },
                });
                sendStatus();
                return;
              }
              if (message.ping) {
                send({ pong: {} });
                return;
              }
              if (message.event) {
                const event = record.parse(record.parse(message.event).data);
                if (event.state) {
                  const data = state.parse(record.parse(event.state).data);
                  if (data.streaming !== undefined)
                    await updateMoblin(id, connectionId!, revision, data);
                }
                if (event.status) {
                  const data = status.parse(event.status);
                  const bitrate = data.topRight?.bitrateInfo?.bitsPerSecond;
                  if (bitrate !== undefined)
                    await updateMoblin(id, connectionId!, revision, {
                      kbps: Math.round(bitrate / 1000),
                    });
                }
              }
              if (message.response) {
                const response = record.parse(message.response);
                if (response.data) {
                  const data = record.parse(response.data);
                  if (data.getStatus) {
                    const parsed = status.parse(data.getStatus);
                    const bitrate = parsed.topRight?.bitrateInfo?.bitsPerSecond;
                    if (bitrate !== undefined)
                      await updateMoblin(id, connectionId!, revision, {
                        kbps: Math.round(bitrate / 1000),
                      });
                  }
                }
              }
              // Chat OAuth tokens, logs, preview images and unrelated controls are
              // neither requested nor retained by this integration.
            })
            .catch(() => {
              ws.close(1008, 'Invalid message or revoked pairing');
            })
            .finally(() => {
              pending--;
            });
        });
      });
    })()
      .catch(() => socket.destroy())
      .finally(() => {
        pendingUpgrades--;
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const health = async () =>
    db
      .insert(serviceHeartbeat)
      .values({ id: 'moblin', at: new Date() })
      .onConflictDoUpdate({ target: serviceHeartbeat.id, set: { at: new Date() } });
  await health();
  let healthBusy = false;
  const healthTimer = setInterval(() => {
    if (healthBusy) return;
    healthBusy = true;
    void health()
      .catch(() => {})
      .finally(() => {
        healthBusy = false;
      });
  }, 5000);
  return {
    server,
    async close() {
      stopping = true;
      clearInterval(healthTimer);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.delete(serviceHeartbeat).where(eq(serviceHeartbeat.id, 'moblin'));
    },
  };
}
