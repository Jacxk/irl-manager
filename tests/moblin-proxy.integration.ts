import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
// Build with MOBLIN_GATEWAY_URL=http://127.0.0.1:3171, then run this test.
const upstream = new WebSocketServer({ host: '127.0.0.1', port: 3171 });
await once(upstream, 'listening');
let path = '';
upstream.on('connection', (socket, request) => {
  path = request.url ?? '';
  socket.send(JSON.stringify({ hello: { apiVersion: '0.1' } }));
  socket.on('message', (data) => socket.send(data));
});
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3170'], {
  stdio: 'ignore',
});
let ws: WebSocket | undefined;
try {
  for (let i = 0; i < 60; i++) {
    assert.equal(app.exitCode, null);
    try {
      if ((await fetch('http://localhost:3170/moblin/health')).status === 426) break;
    } catch {}
    await delay(100);
  }
  ws = new WebSocket('ws://localhost:3170/moblin/11111111-1111-4111-8111-111111111111');
  const greeting = once(ws, 'message');
  await once(ws, 'open');
  assert.deepEqual(JSON.parse((await greeting)[0].toString()), { hello: { apiVersion: '0.1' } });
  assert.equal(path, '/moblin/11111111-1111-4111-8111-111111111111');
  const response = once(ws, 'message');
  ws.send(JSON.stringify({ ping: {} }));
  assert.deepEqual(JSON.parse((await response)[0].toString()), { ping: {} });
  console.log(
    'Production Next.js WebSocket rewrite forwarded the configured app URL/path and bidirectional messages without a separate public gateway port.',
  );
} finally {
  ws?.terminate();
  for (const client of upstream.clients) client.terminate();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  app.kill('SIGTERM');
  await once(app, 'exit');
}
