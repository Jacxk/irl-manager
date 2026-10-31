import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHealth, retryDelay } from '../src/lib/lifecycle';
const base = {
  desired: 'running',
  manual: false,
  now: 100000,
  lastFrame: 99000,
  stableSince: 90000,
  started: 80000,
  graceSeconds: 300,
};
test('healthy input restores live only after recovery window', () => {
  assert.equal(nextHealth(base), 'live');
  assert.equal(nextHealth({ ...base, stableSince: 98000 }), 'recovering');
});
test('socket without arriving frames degrades and then selects fallback', () => {
  assert.equal(nextHealth({ ...base, lastFrame: 97000 }), 'degraded');
  assert.equal(nextHealth({ ...base, lastFrame: 94000 }), 'fallback');
});
test('intentional stop ends even when input remains healthy', () => {
  assert.equal(nextHealth({ ...base, desired: 'stopped' }), 'ended');
});
test('disconnect preserves session until grace deadline', () => {
  assert.equal(nextHealth({ ...base, lastFrame: 1000, now: 300999 }), 'fallback');
  assert.equal(nextHealth({ ...base, lastFrame: 1000, now: 301000 }), 'ended');
});
test('no input uses session start as timeout origin', () => {
  assert.equal(nextHealth({ ...base, lastFrame: 0, now: 81000 }), 'starting');
  assert.equal(nextHealth({ ...base, lastFrame: 0, now: 90000 }), 'fallback');
  assert.equal(nextHealth({ ...base, lastFrame: 0, now: 380000 }), 'ended');
});
test('manual fallback does not defeat disconnect auto-end', () => {
  assert.equal(nextHealth({ ...base, manual: true }), 'fallback');
  assert.equal(nextHealth({ ...base, manual: true, lastFrame: 1000, now: 400000 }), 'ended');
});
test('destination retries have bounded exponential backoff', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 100].map(retryDelay),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000],
  );
});
