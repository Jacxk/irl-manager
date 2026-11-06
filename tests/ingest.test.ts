import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { encoderConnection, encoderFields, publishIdentity } from '../src/lib/ingest';

const id = '11111111-1111-4111-8111-111111111111';
const key = 'abc123key';

test('publish auth accepts a normal query and a stream key with an encoded question mark', () => {
  assert.deepEqual(
    publishIdentity({ action: 'publish', path: `input_${id}`, user: id, password: key }),
    { path: `input_${id}`, user: id, password: key },
  );
  const encoded = encodeURIComponent(`input_${id}?user=${id}&pass=${key}`);
  assert.deepEqual(publishIdentity({ action: 'publish', path: encoded, user: '', password: '' }), {
    path: `input_${id}`,
    user: id,
    password: key,
  });
  assert.deepEqual(
    publishIdentity({
      action: 'publish',
      path: `input_${id}?user=${id}&pass=${key}`,
      user: '',
      password: '',
    }),
    { path: `input_${id}`, user: id, password: key },
  );
  assert.deepEqual(
    publishIdentity({
      action: 'publish',
      path: `input_${id}`,
      query: `user=${id}&pass=${key}`,
    }),
    { path: `input_${id}`, user: id, password: key },
  );
  for (const body of [
    { action: 'read', path: `input_${id}`, user: id, password: key },
    { action: 'publish', path: `program_${id}`, user: id, password: key },
    { action: 'publish', path: `input_${id}`, user: id },
    { action: 'publish', path: `input_${id}/extra?user=${id}&pass=${key}` },
    { action: 'publish', path: encodeURIComponent('../secret'), user: id, password: key },
  ])
    assert.equal(publishIdentity(body), null);
});

test('encoder instructions split Moblin SRT and RTMP fields', () => {
  const connection = encoderConnection({
    host: 'live.example',
    path: `input_${id}`,
    username: id,
    key,
  });
  assert.equal(connection.rtmpServer, 'rtmp://live.example:1935');
  assert.equal(connection.rtmpStreamKey, `input_${id}?user=${id}&pass=${key}`);
  assert.equal(connection.srtServer, 'srt://live.example:8890');
  assert.equal(connection.srtStreamId, `publish:input_${id}:${id}:${key}`);
  assert.ok(connection.srtUrl.includes(`streamid=${connection.srtStreamId}`));
  assert.equal(connection.srtlaAddress, 'live.example:5000');
  assert.equal(connection.localOnly, false);
  assert.equal(
    encoderFields({ host: '127.0.0.1', path: `input_${id}`, username: id, key }, 'srtla').fields[0]
      ?.label,
    'SRTLA URL',
  );
  assert.equal(
    encoderFields({ host: 'live.example', path: `input_${id}`, username: id, key }, 'rtmp').fields[0]
      ?.label,
    'RTMP URL',
  );
  assert.equal(encoderConnection({ host: '127.0.0.1', path: 'input_x', username: 'u', key: 'k' }).localOnly, true);
});

test('rebasing live frames keeps FLV timestamps strictly increasing', () => {
  const result = spawnSync('python3', ['tests/timestamps.test.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
