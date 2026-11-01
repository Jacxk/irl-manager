import { Client } from 'ssh2';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
export type SshOptions = {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
};
export function fingerprint(key: Buffer) {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}
export async function scanHost(options: Pick<SshOptions, 'host' | 'port' | 'username'>) {
  return new Promise<string>((resolve, reject) => {
    const client = new Client();
    let found = false;
    client.on('error', (e) => {
      if (!found) reject(e);
    });
    client.connect({
      ...options,
      readyTimeout: 15000,
      hostVerifier: (key: Buffer) => {
        found = true;
        resolve(fingerprint(key as Buffer));
        queueMicrotask(() => client.destroy());
        return false;
      },
    });
  });
}
export async function sshConnect(options: SshOptions, pinned: string) {
  return new Promise<Client>((resolve, reject) => {
    const client = new Client();
    client.once('ready', () => resolve(client));
    client.once('error', reject);
    client.connect({
      ...options,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
      hostVerifier: (key: Buffer) => fingerprint(key as Buffer) === pinned,
    });
  });
}
export async function sshExec(
  client: Client,
  command: string,
  input: Buffer | string | undefined,
  onLine: (line: string) => void,
) {
  return new Promise<void>((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let buffer = '';
      const timeout = setTimeout(
        () => {
          stream.close();
          reject(
            new Error(
              'Remote installation timed out after 30 minutes. Check the saved logs and retry.',
            ),
          );
        },
        30 * 60 * 1000,
      );
      timeout.unref();
      const data = (chunk: Buffer) => {
        buffer += chunk.toString();
        let pos;
        while ((pos = buffer.indexOf('\n')) !== -1) {
          onLine(buffer.slice(0, pos));
          buffer = buffer.slice(pos + 1);
        }
        if (buffer.length > 8192) {
          onLine(buffer.slice(0, 8192));
          buffer = '';
        }
      };
      stream.on('data', data);
      stream.stderr.on('data', data);
      stream.once('error', reject);
      stream.once('close', (code: number) => {
        clearTimeout(timeout);
        if (buffer) onLine(buffer);
        if (code === 0) resolve();
        else reject(new Error(`Remote command exited with status ${code}.`));
      });
      if (input !== undefined) stream.end(input);
      else stream.end();
    });
  });
}
export async function upload(client: Client, local: string, remote: string) {
  await new Promise<void>((resolve, reject) =>
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }
      sftp.fastPut(local, remote, { mode: 0o600 }, (e) => {
        sftp.end();
        if (e) reject(e);
        else resolve();
      });
    }),
  );
}
export async function localExec(
  command: string,
  args: string[],
  onLine: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(
      () => {
        child.kill('SIGTERM');
        reject(
          new Error(
            'Installation command timed out after 30 minutes. Check the saved logs and retry.',
          ),
        );
      },
      30 * 60 * 1000,
    );
    timeout.unref();
    let buffer = '';
    const data = (chunk: Buffer) => {
      buffer += chunk;
      let pos;
      while ((pos = buffer.indexOf('\n')) !== -1) {
        onLine(buffer.slice(0, pos));
        buffer = buffer.slice(pos + 1);
      }
      if (buffer.length > 8192) {
        onLine(buffer.slice(0, 8192));
        buffer = '';
      }
    };
    child.stdout.on('data', data);
    child.stderr.on('data', data);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (buffer) onLine(buffer);
      if (code === 0) resolve();
      else reject(new Error(`Command exited with status ${code}.`));
    });
  });
}
