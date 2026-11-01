import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const f = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3147';
const res = await fetch(base + '/api/control', {
  method: 'POST',
  headers: { Origin: base, Cookie: f.owner.cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'scene',
    channelId: f.channel.id,
    title: 'Transaction test',
    subtitle: '',
    color: '#101820',
    graceSeconds: 30,
  }),
  signal: AbortSignal.timeout(5000),
});
assert.equal(res.status, 200, await res.text());
console.log('PASS channel mutation completes while holding its transaction row lock');
