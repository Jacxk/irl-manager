import { readFileSync, writeFileSync } from 'node:fs';
const path = '/tmp/irl-manager-fixture.json';
const fixture = JSON.parse(readFileSync(path, 'utf8'));
const env = readFileSync('.env', 'utf8');
if (fixture.previousServerId === undefined) {
  fixture.previousServerId = env.match(/^MEDIA_SERVER_ID=(.*)$/m)?.[1] ?? '';
  if (fixture.previousServerId === fixture.server.id) fixture.previousServerId = '';
  writeFileSync(path, JSON.stringify(fixture), { mode: 0o600 });
}
writeFileSync(
  '.env',
  env.replace(/^MEDIA_SERVER_ID=.*$/m, `MEDIA_SERVER_ID=${fixture.server.id}`),
  { mode: 0o600 },
);
console.log('Configured MEDIA_SERVER_ID for the disposable media-test fixture.');
