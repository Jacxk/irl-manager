import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  tokenHash,
  safeEqual,
  validControlUrl,
  localInstallAllowed,
} from '../src/lib/nodes/security';
import { fingerprint } from '../installer/transport';
test('remote control origins require HTTPS and exclude embedded credentials and paths', () => {
  const previous = process.env.ALLOW_INSECURE_NODE_CONTROL;
  process.env.ALLOW_INSECURE_NODE_CONTROL = '0';
  try {
    assert.equal(validControlUrl('https://control.example', 'ssh'), 'https://control.example');
    for (const url of [
      'http://control.example',
      'https://user:secret@control.example',
      'https://control.example/api',
      'file:///tmp/node',
    ])
      assert.throws(() => validControlUrl(url, 'ssh'));
    assert.equal(validControlUrl('http://localhost:3000', 'local'), 'http://localhost:3000');
  } finally {
    if (previous === undefined) delete process.env.ALLOW_INSECURE_NODE_CONTROL;
    else process.env.ALLOW_INSECURE_NODE_CONTROL = previous;
  }
});
test('local root-capable installation requires an explicit account allowlist', () => {
  const flag = process.env.ENABLE_LOCAL_INSTALL,
    emails = process.env.LOCAL_INSTALL_ADMIN_EMAILS;
  try {
    process.env.ENABLE_LOCAL_INSTALL = '1';
    process.env.LOCAL_INSTALL_ADMIN_EMAILS = 'owner@example.com';
    assert.equal(localInstallAllowed('OWNER@example.com'), true);
    assert.equal(localInstallAllowed('another-owner@example.com'), false);
    process.env.ENABLE_LOCAL_INSTALL = '0';
    assert.equal(localInstallAllowed('owner@example.com'), false);
  } finally {
    if (flag === undefined) delete process.env.ENABLE_LOCAL_INSTALL;
    else process.env.ENABLE_LOCAL_INSTALL = flag;
    if (emails === undefined) delete process.env.LOCAL_INSTALL_ADMIN_EMAILS;
    else process.env.LOCAL_INSTALL_ADMIN_EMAILS = emails;
  }
});
test('node tokens are hashed and SSH host fingerprints match OpenSSH SHA256 format', () => {
  const key = Buffer.from('test host key');
  assert.equal(
    fingerprint(key),
    'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, ''),
  );
  assert.equal(tokenHash('node-token').length, 64);
  assert.equal(safeEqual('one', 'one'), true);
  assert.equal(safeEqual('one', 'two'), false);
  assert.equal(safeEqual('one', 'longer'), false);
});
