import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moblinAuthentication,
  verifyMoblinAuthentication,
  moblinEndpoint,
  nextMoblinBitrate,
  moblinFallbackActive,
} from '../src/lib/moblin/protocol';
import { resolveSetting } from '../src/lib/settings-registry';
import { nextHealth } from '../src/lib/lifecycle';
test('Moblin authentication matches the upstream double SHA256/base64 protocol and rejects replay', () => {
  const hash = moblinAuthentication('test-password', 'test-salt', 'test-challenge');
  assert.equal(hash, 'zBIloly70ANx+T9nUkQVuTCqTUuHtfrqEdn8XDQ3m/s=');
  assert.equal(verifyMoblinAuthentication(hash, hash), true);
  assert.equal(
    verifyMoblinAuthentication(
      hash,
      moblinAuthentication('test-password', 'test-salt', 'new-challenge'),
    ),
    false,
  );
  assert.equal(verifyMoblinAuthentication('', hash), false);
});
test('low bitrate requires a sustained drop and stable hysteresis recovery', () => {
  let c = {
    lowBitrateKbps: 500,
    lowBitrateSeconds: 5,
    recoverySeconds: 5,
    lowSince: null as Date | null,
    healthySince: null as Date | null,
    lowBitrateActive: false,
  };
  const at = (s: number) => new Date(100000 + s * 1000);
  c = { ...c, ...nextMoblinBitrate(c, 200, at(0)) };
  assert.equal(nextMoblinBitrate(c, 200, at(4)).lowBitrateActive, false);
  c = { ...c, ...nextMoblinBitrate(c, 200, at(5)) };
  assert.equal(c.lowBitrateActive, true);
  c = { ...c, ...nextMoblinBitrate(c, 550, at(6)) };
  assert.equal(c.lowBitrateActive, true, 'threshold band does not flicker back to live');
  c = { ...c, ...nextMoblinBitrate(c, 700, at(7)) };
  assert.equal(nextMoblinBitrate(c, 700, at(11)).lowBitrateActive, true);
  assert.equal(nextMoblinBitrate(c, 700, at(12)).lowBitrateActive, false);
  assert.equal(nextMoblinBitrate({ ...c, lowBitrateKbps: 0 }, 0, at(13)).lowBitrateActive, false);
  assert.equal(
    nextMoblinBitrate({ ...c, bitrateAt: at(0) }, 100, at(30)).lowBitrateActive,
    false,
    'a telemetry gap restarts the low bitrate observation window',
  );
  assert.equal(
    moblinFallbackActive(
      { enabled: true, lowBitrateActive: true, bitrateAt: at(0) },
      at(14).getTime(),
    ),
    true,
  );
  assert.equal(
    moblinFallbackActive(
      { enabled: true, lowBitrateActive: true, bitrateAt: at(0) },
      at(15).getTime(),
    ),
    false,
  );
  assert.equal(
    moblinFallbackActive(
      { enabled: false, lowBitrateActive: true, bitrateAt: at(0) },
      at(1).getTime(),
    ),
    false,
  );
});
test('Moblin fallback does not defeat intentional stop or disconnect timeout', () => {
  const input = {
    desired: 'running',
    manual: true,
    now: 10000,
    lastFrame: 9000,
    stableSince: 0,
    started: 0,
    graceSeconds: 15,
  };
  assert.equal(nextHealth(input), 'fallback');
  assert.equal(nextHealth({ ...input, desired: 'stopped' }), 'ended');
  assert.equal(nextHealth({ ...input, now: 24000 }), 'ended');
});
test('Moblin policies and defaults validate and preserve environment precedence', () => {
  assert.equal(resolveSetting('allowMoblinControl', undefined, {}).value, true);
  assert.equal(resolveSetting('maxMoblinPreviewPrograms', undefined, {}).value, 2);
  assert.equal(resolveSetting('maxMoblinPreviewPrograms', 0, {}).value, 0);
  assert.throws(() => resolveSetting('maxMoblinPreviewPrograms', 17, {}));
  assert.throws(() => resolveSetting('maxMoblinPreviewPrograms', -1, {}));
  assert.equal(
    resolveSetting('maxMoblinPreviewPrograms', 2, {
      MAX_MOBLIN_PREVIEW_PROGRAMS: '0',
      LOCK_BY_ENVIRONMENT: 'true',
    }).value,
    0,
  );
  assert.equal(resolveSetting('moblinDefaultLowBitrateKbps', undefined, {}).value, 500);
  assert.equal(
    resolveSetting('allowMoblinControl', true, {
      ALLOW_MOBLIN_CONTROL: 'false',
      LOCK_BY_ENVIRONMENT: 'true',
    }).value,
    false,
  );
  assert.throws(() => resolveSetting('maxMoblinConnections', 0, {}));
  assert.throws(() => resolveSetting('moblinDefaultRecoverySeconds', 1, {}));
  assert.throws(() => resolveSetting('moblinPublicUrl', 'ws://public.example.com/moblin', {}));
  assert.throws(() =>
    resolveSetting('moblinPublicUrl', 'wss://user:secret@example.com/moblin', {}),
  );
  assert.throws(() => resolveSetting('moblinPublicUrl', 'wss://example.com/moblin?secret=x', {}));
  assert.equal(
    resolveSetting('moblinPublicUrl', 'ws://localhost:3001/moblin', {}).value,
    'ws://localhost:3001/moblin',
  );
  assert.equal(
    moblinEndpoint('https://example.com', '', 'channel'),
    'wss://example.com/moblin/channel',
  );
  assert.equal(
    moblinEndpoint('http://localhost:3000', '', 'channel'),
    'ws://localhost:3000/moblin/channel',
  );
});

test('Moblin uses the configured domain and port, with no LAN address inference', () => {
  assert.equal(
    moblinEndpoint('https://stream.example.com', '', 'channel'),
    'wss://stream.example.com/moblin/channel',
  );
  assert.equal(
    moblinEndpoint('https://stream.example.com:8443', '', 'channel'),
    'wss://stream.example.com:8443/moblin/channel',
  );
  assert.equal(
    moblinEndpoint('https://app.example.com', 'wss://control.example.com/moblin', 'channel'),
    'wss://control.example.com/moblin/channel',
  );
  assert.throws(() => moblinEndpoint('http://public.example.com', '', 'channel'));
  assert.throws(() =>
    moblinEndpoint('https://app.example.com', 'ws://public.example.com/moblin', 'channel'),
  );
});
