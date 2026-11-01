import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('/tmp/irl-manager-fixture.json', 'utf8'));
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
if (process.env.TEST_DISPOSABLE_NODE !== '1')
  throw new Error(
    'Set TEST_DISPOSABLE_NODE=1 only for the isolated node created by this test run.',
  );
const nodeId = fixture.remoteNodeId ?? fixture.localInstallation?.nodeId;
assert.ok(nodeId, 'An installed fixture node is required');
const url = `${base}/api/nodes/${nodeId}/removal`;
const headers = { Origin: base, Cookie: fixture.owner.cookie, 'Content-Type': 'application/json' };
const planResponse = await fetch(url, { headers });
assert.equal(planResponse.status, 200);
const plan = await planResponse.json();
assert.equal(plan.managed, true);
assert.ok(plan.counts.channels > 0);
const wrongName = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({ confirmation: 'incorrect name', permanent: true }),
});
assert.equal(wrongName.status, 400);
const removal = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    confirmation: plan.node.name,
    permanent: true,
    credentials: { method: 'key', privateKey: readFileSync('/tmp/irl-installer-test-key', 'utf8') },
  }),
});
assert.equal(removal.status, 200, await removal.text());
const deadline = Date.now() + 90000;
let removed = false;
while (Date.now() < deadline) {
  const response = await fetch(url, { headers });
  if (response.status === 404) {
    removed = true;
    break;
  }
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.notEqual(state.installation?.status, 'remove_failed', state.installation?.error);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(removed, true, 'Installed node removal must finish');
const control = await (await fetch(base + '/api/control', { headers })).json();
assert.ok(!control.channels.some((c: { id: string }) => c.id === fixture.channel.id));
console.log(
  'PASS real installed node removal, exact-name confirmation, and channel cascade cleanup',
);
