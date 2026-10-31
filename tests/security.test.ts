import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../src/lib/crypto';
import { rtmpUrl, commandSchema } from '../src/lib/validation';
process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
test('stream keys round trip with randomized authenticated encryption', () => {
  const one = encrypt('private-key');
  const two = encrypt('private-key');
  assert.notEqual(one, two);
  assert.ok(!one.includes('private-key'));
  assert.equal(decrypt(one), 'private-key');
  const parts = one.split(':');
  parts[2] = 'ff' + parts[2].slice(2);
  assert.throws(() => decrypt(parts.join(':')));
});
test('destinations allow RTMP and RTMPS but reject other protocols and embedded secrets', () => {
  assert.ok(rtmpUrl.safeParse('rtmps://example.com:443/live').success);
  for (const value of [
    'https://example.com/live',
    'file:///etc/passwd',
    'rtmp://user:pass@example.com/live',
    'rtmp://example.com/live?key=secret',
  ])
    assert.ok(!rtmpUrl.safeParse(value).success);
});
test('scene settings reject unbounded grace periods and malformed colors', () => {
  const scene = {
    action: 'scene',
    channelId: randomBytes(16).toString('hex'),
    title: 'BRB',
    subtitle: '',
    color: 'red',
    graceSeconds: 0,
  };
  assert.ok(!commandSchema.safeParse(scene).success);
});
