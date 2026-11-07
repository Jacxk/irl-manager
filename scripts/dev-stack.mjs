import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.env') || !existsSync('node_modules/.bin/next')) {
  console.error('Run npm ci and npm run setup first; see CONTRIBUTING.md for initial database setup.');
  process.exit(1);
}

console.log('Starting PostgreSQL (the existing volume is preserved)...');
const database = spawnSync('docker', ['compose', 'up', '-d', '--wait', '--no-recreate', 'db'], {
  stdio: 'inherit',
});
if (database.error || database.status !== 0) {
  console.error('Could not start PostgreSQL. Check that Docker and Compose are available.');
  process.exit(1);
}

const children = new Set();
let stopping = false;
let exitCode = 0;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      // The process may have already exited.
    }
  }
  if (children.size === 0) process.exit(exitCode);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());

for (const name of ['dev', 'installer', 'moblin']) {
  const child = spawn('npm', ['run', name], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(`Could not start ${name}: ${error.message}`);
    stop(1);
  });
  child.on('close', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} stopped (${signal ?? code}); stopping the development stack.`);
      stop(code || 1);
    }
    if (stopping && children.size === 0) process.exit(exitCode);
  });
}
console.log('Development stack starting. Open http://localhost:3000; Ctrl+C stops the host processes.');
