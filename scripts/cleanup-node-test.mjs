// Removes only the deployment owned by the disposable integration fixture.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const fixturePath = '/tmp/irl-manager-fixture.json';
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const nodeIds = [fixture.installation?.nodeId, fixture.localInstallation?.nodeId].filter(Boolean);
let volumeExists = false;
try {
  execFileSync('docker', ['volume', 'inspect', 'irl-manager-node-identity'], { stdio: 'ignore' });
  volumeExists = true;
} catch {}
if (volumeExists) {
  const owner = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      'irl-manager-node-identity:/identity',
      'alpine:3.21',
      'cat',
      '/identity/claim/owner',
    ],
    { encoding: 'utf8' },
  );
  if (!nodeIds.some((id) => owner.endsWith(':' + id)))
    throw new Error('Refusing to remove a Docker node identity outside this fixture.');
  try {
    const inspected = JSON.parse(
      execFileSync('docker', ['inspect', 'irl-node-worker-1'], { encoding: 'utf8' }),
    )[0];
    const vars = inspected.Config.Env;
    if (
      vars.some((value) => value.startsWith('DATABASE_URL=') || value.startsWith('ENCRYPTION_KEY='))
    )
      throw new Error('Managed agent unexpectedly received application/database secrets.');
    if (!nodeIds.some((id) => vars.includes('NODE_ID=' + id)))
      throw new Error('Refusing to stop a node outside this fixture.');
    console.log('Verified the managed agent has no database URL or application encryption key.');
  } catch (error) {
    if (!String(error).includes('No such object')) throw error;
  }
  for (const name of ['irl-node-worker-1', 'irl-node-media-1', 'irl-node-srtla-1']) {
    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    } catch {}
  }
  execFileSync('docker', ['volume', 'rm', 'irl-manager-node-identity'], { stdio: 'ignore' });
}
for (const name of ['irl-installer-ssh-target', 'irl-installer-sink']) {
  try {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  } catch {}
}
let env = readFileSync('.env', 'utf8');
for (const [key, backup] of [
  ['ALLOW_INSECURE_NODE_CONTROL', 'previousInsecure'],
  ['ENABLE_LOCAL_INSTALL', 'previousLocalEnabled'],
  ['LOCAL_INSTALL_ADMIN_EMAILS', 'previousLocalAdmins'],
]) {
  if (!(backup in fixture)) continue;
  const pattern = new RegExp('^' + key + '=.*$', 'm');
  const value = fixture[backup];
  env =
    value === null
      ? env.replace(new RegExp('^' + key + '=.*\\n?', 'm'), '')
      : pattern.test(env)
        ? env.replace(pattern, key + '=' + value)
        : env + '\n' + key + '=' + value + '\n';
}
writeFileSync('.env', env, { mode: 0o600 });
for (const file of ['/tmp/irl-installer-test-key', '/tmp/irl-installer-test-key.pub'])
  try {
    unlinkSync(file);
  } catch {}
console.log(
  'Removed disposable node services, identity, SSH target, and temporary test permissions. Database fixture retained for subsequent checks.',
);
