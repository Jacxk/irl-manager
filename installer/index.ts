import 'dotenv/config';
import { removeNode } from './remove';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { nodeInstallation, mediaServer, serviceHeartbeat, nodePreview } from '../src/lib/db/schema';
import { decrypt } from '../src/lib/crypto';
import { scanHost, sshConnect, sshExec, upload, localExec } from './transport';
const source = process.env.APP_SOURCE_DIR ?? process.cwd();
const root = process.env.INSTALLER_DATA_DIR ?? path.join(source, '.irl-installer');
await mkdir(root, { recursive: true, mode: 0o700 });
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
let localMachineId: string | null = null;
try {
  const result = await promisify(execFile)('docker', ['info', '--format', '{{.ID}}']);
  if (result.stdout.trim())
    localMachineId = createHash('sha256').update(result.stdout.trim()).digest('hex');
} catch {
  /* SSH-only installers can run without local Docker access. */
}
const heartbeat = () =>
  db
    .insert(serviceHeartbeat)
    .values({ id: 'installer', at: new Date(), machineId: localMachineId })
    .onConflictDoUpdate({
      target: serviceHeartbeat.id,
      set: { at: new Date(), machineId: localMachineId },
    });
const heartTimer = setInterval(() => void heartbeat().catch(() => {}), 5000);
await heartbeat();
async function run(job: typeof nodeInstallation.$inferSelect) {
  const logs = [...job.logs];
  let pending: Promise<unknown> = Promise.resolve();
  let stage = job.step;
  let machineId: string | undefined;
  const secrets = job.encryptedCredentials ? JSON.parse(decrypt(job.encryptedCredentials)) : {};
  const node = await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, job.nodeId) });
  if (!node?.encryptedAgentToken) throw new Error('Node credentials are missing.');
  const token = decrypt(node.encryptedAgentToken);
  const redact = (line: string) => {
    let result = line
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
      .slice(0, 2000);
    for (const secret of [token, ...Object.values(secrets)])
      if (typeof secret === 'string' && secret.length > 3)
        result = result.replaceAll(secret, '[redacted]');
    return result;
  };
  const log = (raw: string) => {
    const message = redact(raw);
    if (!message.trim()) return;
    if (message.startsWith('IRL_STEP:')) stage = message.slice(9);
    if (message.startsWith('IRL_MACHINE:'))
      machineId = createHash('sha256').update(message.slice(12).trim()).digest('hex');
    logs.push({ at: new Date().toISOString(), message: message.replace(/^IRL_STEP:/, '') });
    if (logs.length > 500) logs.splice(0, logs.length - 500);
  };
  const persist = () => {
    pending = pending
      .catch(() => {})
      .then(() =>
        db
          .update(nodeInstallation)
          .set({ logs: [...logs], step: stage, updatedAt: new Date() })
          .where(eq(nodeInstallation.id, job.id)),
      );
    return pending;
  };
  const timer = setInterval(() => void persist().catch(() => {}), 2000);
  let client: Awaited<ReturnType<typeof sshConnect>> | undefined;
  let spool: string | undefined;
  try {
    if (job.status === 'queued_check' || job.status === 'checking') {
      await db
        .update(nodeInstallation)
        .set({ status: 'checking', step: 'Checking the SSH host key', updatedAt: new Date() })
        .where(eq(nodeInstallation.id, job.id));
      log(
        'Connecting to SSH and reading the host key. No host commands run until you confirm its fingerprint.',
      );
      const pinned = await scanHost({
        host: job.config.sshHost,
        port: job.config.sshPort,
        username: job.config.sshUser,
      });
      clearInterval(timer);
      await pending;
      await db
        .update(nodeInstallation)
        .set({
          status: 'awaiting_trust',
          step: 'verify',
          fingerprint: pinned,
          logs: [...logs],
          updatedAt: new Date(),
        })
        .where(eq(nodeInstallation.id, job.id));
      return;
    }
    await db
      .update(nodeInstallation)
      .set({
        status: 'installing',
        startedAt: job.startedAt ?? new Date(),
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(nodeInstallation.id, job.id));
    spool = await mkdtemp(path.join(root, 'bundle-'));
    const control = new URL(job.config.controlUrl);
    if (job.mode === 'local' && ['localhost', '127.0.0.1'].includes(control.hostname))
      control.hostname = 'host.docker.internal';
    const insecure =
      control.protocol === 'http:' &&
      (job.mode === 'local' || process.env.ALLOW_INSECURE_NODE_CONTROL === '1');
    await writeFile(
      path.join(spool, '.env'),
      `NODE_ID=${job.nodeId}\nNODE_TOKEN=${token}\nCONTROL_URL=${control.origin}\nALLOW_INSECURE_NODE_CONTROL=${insecure ? '1' : '0'}\n`,
      { mode: 0o600 },
    );
    const archive = path.join(spool, 'node.tgz');
    log(
      'Preparing a private node bundle. Database credentials and application secrets are excluded.',
    );
    await persist();
    await localExec(
      'tar',
      [
        '--no-xattrs',
        '-czf',
        archive,
        '-C',
        source,
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'worker',
        'src/lib/db',
        'src/lib/crypto.ts',
        'src/lib/lifecycle.ts',
        'infra/worker.Dockerfile',
        'infra/mediamtx.yml',
        'infra/srtla.Dockerfile',
        'infra/node-compose.yml',
        'infra/node-media.Dockerfile',
        '-C',
        spool,
        '.env',
      ],
      log,
    );
    const script = await readFile(path.join(source, 'installer/install.sh'), 'utf8');
    const controlId = createHash('sha256').update(token).digest('hex');
    if (job.mode === 'local') {
      log('Installing on the current Docker host. Existing IRL node identity will be checked.');
      const scriptPath = path.join(spool, 'install.sh');
      await writeFile(scriptPath, script, { mode: 0o700 });
      await localExec('sh', [scriptPath, archive, job.nodeId, controlId, 'local'], log, {
        ...process.env,
        IRL_INSTALL_ROOT: path.join(root, 'local-node'),
      });
    } else {
      if (!job.fingerprint) throw new Error('Confirm the SSH host fingerprint before installing.');
      log('Connecting over SSH with the verified host key.');
      await persist();
      client = await sshConnect(
        {
          host: job.config.sshHost,
          port: job.config.sshPort,
          username: job.config.sshUser,
          ...secrets,
        },
        job.fingerprint,
      );
      const remote = `/tmp/irl-node-${job.id}.tgz`;
      await upload(client, archive, remote);
      log('Bundle uploaded over SSH. Checking root or passwordless sudo access.');
      // All arguments are generated UUIDs/hashes and fixed paths, never credentials.
      const command = `${job.config.sshUser === 'root' ? '' : 'sudo -n '}sh -s -- ${remote} ${job.nodeId} ${controlId} ssh`;
      await sshExec(client, command, script, log);
    }
    if (!machineId) throw new Error('The installation did not report a Docker machine identity.');
    await db.update(mediaServer).set({ machineId }).where(eq(mediaServer.id, job.nodeId));
    clearInterval(timer);
    await persist();
    await db
      .update(nodeInstallation)
      .set({
        status: 'waiting',
        step: 'Waiting for the first healthy node heartbeat',
        updatedAt: new Date(),
      })
      .where(eq(nodeInstallation.id, job.id));
  } catch (error) {
    clearInterval(timer);
    log(error instanceof Error ? error.message : 'Installation failed.');
    await persist().catch(() => {});
    await db
      .update(nodeInstallation)
      .set({
        status: 'failed',
        error: redact(error instanceof Error ? error.message : 'Installation failed.'),
        logs: [...logs],
        updatedAt: new Date(),
      })
      .where(eq(nodeInstallation.id, job.id));
  } finally {
    clearInterval(timer);
    client?.end();
    if (spool) await rm(spool, { recursive: true, force: true });
  }
}
console.log('Node installer ready. Waiting for local and SSH installation jobs.');
while (!stopping) {
  try {
    await db.delete(nodePreview).where(lt(nodePreview.expiresAt, new Date()));
    const waiting = await db
      .select()
      .from(nodeInstallation)
      .where(eq(nodeInstallation.status, 'waiting'));
    for (const job of waiting) {
      const node = await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, job.nodeId) });
      if (node?.heartbeatAt && Date.now() - node.heartbeatAt.getTime() < 15000)
        await db
          .update(nodeInstallation)
          .set({
            status: 'complete',
            step: 'Ready',
            encryptedCredentials: null,
            error: null,
            updatedAt: new Date(),
            logs: [
              ...job.logs,
              {
                at: new Date().toISOString(),
                message: 'Node connected. Ready for channels and broadcasts.',
              },
            ],
          })
          .where(eq(nodeInstallation.id, job.id));
      else if (Date.now() - job.updatedAt.getTime() > 180000)
        await db
          .update(nodeInstallation)
          .set({
            status: 'failed',
            step: 'waiting',
            error:
              'Services started but no heartbeat arrived. Check the app URL, outbound HTTPS, and docker compose logs on the node. Retry to reconnect.',
            updatedAt: new Date(),
          })
          .where(eq(nodeInstallation.id, job.id));
    }
    const jobs = await db
      .select()
      .from(nodeInstallation)
      .where(
        or(
          inArray(nodeInstallation.status, [
            'queued_check',
            'queued_install',
            'queued_remove',
            'remote_removed',
          ]),
          and(
            inArray(nodeInstallation.status, ['checking', 'installing', 'removing']),
            lt(nodeInstallation.updatedAt, new Date(Date.now() - 45000)),
          ),
        ),
      )
      .orderBy(nodeInstallation.createdAt)
      .limit(1);
    if (jobs[0]) {
      const lease = await sql.reserve();
      const [held] =
        await lease`select pg_try_advisory_lock(hashtext(${`install:${jobs[0].id}`})) as held`;
      try {
        if (held.held) {
          try {
            const current = await db.query.nodeInstallation.findFirst({
              where: eq(nodeInstallation.id, jobs[0].id),
            });
            if (current) {
              if (current.operation === 'remove') await removeNode(current, source, root);
              else await run(current);
            }
          } catch {
            await db
              .update(nodeInstallation)
              .set({
                status: jobs[0].operation === 'remove' ? 'remove_failed' : 'failed',
                error:
                  'Unable to read installation credentials. Verify ENCRYPTION_KEY is consistent on the app and installer, then retry.',
                updatedAt: new Date(),
              })
              .where(eq(nodeInstallation.id, jobs[0].id));
          }
        }
      } finally {
        try {
          await lease`select pg_advisory_unlock(hashtext(${`install:${jobs[0].id}`}))`;
        } finally {
          lease.release();
        }
      }
    }
  } catch (e) {
    console.error('Installer sync failed:', e instanceof Error ? e.name : 'unknown');
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
clearInterval(heartTimer);
await sql.end();
