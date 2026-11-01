import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
const body = JSON.stringify({ action: 'invalid', padding: 'x'.repeat(2 * 1024 * 1024) });
for (const path of ['/api/control', '/api/media/auth']) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { Origin: base, 'content-type': 'application/json' },
    body,
  });
  assert.equal(r.status, 413, `${path} must reject oversized JSON before parsing`);
}
console.log('PASS oversized public JSON requests are rejected with 413');
