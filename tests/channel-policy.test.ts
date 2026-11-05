import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteChannel } from '../src/lib/channel-policy';
import { commandSchema } from '../src/lib/validation';
test('channel deletion waits for live and ending sessions to stop', () => {
  assert.equal(canDeleteChannel({ desired: 'running', state: 'fallback' }), false);
  assert.equal(canDeleteChannel({ desired: 'stopped', state: 'ending' }), false);
  assert.equal(canDeleteChannel({ desired: 'stopped', state: 'ended' }), true);
  assert.equal(canDeleteChannel({ desired: 'stopped', state: 'idle' }), true);
});
test('deletion requires a valid channel identifier', () => {
  assert.equal(commandSchema.safeParse({ action: 'deleteChannel' }).success, false);
  assert.equal(
    commandSchema.safeParse({ action: 'deleteChannel', channelId: 'invalid' }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      action: 'deleteChannel',
      channelId: '924b98fc-6ff7-4712-909d-bd485a65faae',
    }).success,
    true,
  );
});

test('Compose development database is dedicated and production stays blocked', async () => {
  const { validateDevelopmentDatabase } = await import('../src/lib/development');
  assert.doesNotThrow(() =>
    validateDevelopmentDatabase('development', 'postgres://irl:password@db:5432/irl_dev'),
  );
  assert.throws(() =>
    validateDevelopmentDatabase('development', 'postgres://irl:password@db:5432/irl'),
  );
  assert.throws(() =>
    validateDevelopmentDatabase('production', 'postgres://irl:password@db:5432/irl_dev'),
  );
});
