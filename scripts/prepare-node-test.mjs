// Developer-only provisioning fixtures. Use a disposable local Docker host.
import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  copyFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const file = '/tmp/irl-manager-fixture.json';
const fixture = JSON.parse(readFileSync(file, 'utf8'));
const local = process.argv.includes('--local');
if (local) execFileSync(process.execPath, ['scripts/cleanup-node-test.mjs'], { stdio: 'inherit' });
else {
  let occupied = false;
  try {
    execFileSync('docker', ['volume', 'inspect', 'irl-manager-node-identity'], { stdio: 'ignore' });
    occupied = true;
  } catch {}
  if (occupied)
    throw new Error(
      'Use a disposable Docker host with no installed managed node. Existing node identity found.',
    );
  const key = '/tmp/irl-installer-test-key';
  if (existsSync(key))
    throw new Error('Test SSH key already exists. Clean up the previous fixture first.');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-f', key, '-N', ''], { stdio: 'inherit' });
  const context = mkdtempSync(path.join(tmpdir(), 'irl-ssh-context-'));
  try {
    copyFileSync(key + '.pub', path.join(context, 'authorized.pub'));
    execFileSync(
      'docker',
      ['build', '-t', 'irl-ssh-test', '-f', path.resolve('infra/ssh-test.Dockerfile'), context],
      { stdio: 'inherit' },
    );
    execFileSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        'irl-installer-ssh-target',
        '-p',
        '127.0.0.1:22222:22',
        '-v',
        '/var/run/docker.sock:/var/run/docker.sock',
        'irl-ssh-test',
      ],
      { stdio: 'inherit' },
    );
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}
let env = readFileSync('.env', 'utf8');
const fields = local ? [] : [['ALLOW_INSECURE_NODE_CONTROL', '1', 'previousInsecure']];
for (const [key, value, backup] of fields) {
  const regex = new RegExp('^' + key + '=.*$', 'm');
  if (!(backup in fixture))
    fixture[backup] = env.match(new RegExp('^' + key + '=(.*)$', 'm'))?.[1] ?? null;
  env = regex.test(env)
    ? env.replace(regex, key + '=' + value)
    : env + '\n' + key + '=' + value + '\n';
}
writeFileSync('.env', env, { mode: 0o600 });
writeFileSync(file, JSON.stringify(fixture), { mode: 0o600 });
console.log(
  local
    ? 'Local fixture prepared. Enable local installation in Admin → Node operations, then run tests/local-node.integration.ts.'
    : 'SSH fixture ready. Restart the installer so it reads the temporary HTTP-development setting, then run tests/nodes.integration.ts.',
);
