import { createHash } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { mediaServer, nodeInstallation } from '../src/lib/db/schema';
import { decrypt } from '../src/lib/crypto';
import { deleteNodeData } from '../src/lib/nodes/removal';
import { localExec, sshConnect, sshExec } from './transport';
export async function removeNode(
  job: typeof nodeInstallation.$inferSelect,
  source: string,
  root: string,
) {
  if (job.remoteRemovedAt) {
    try {
      await deleteNodeData(job.nodeId, job.workspaceId);
    } catch {
      await db
        .update(nodeInstallation)
        .set({
          status: 'remove_failed',
          error:
            'Remote uninstall is complete, but application data cleanup failed. Retry removal to finish.',
          updatedAt: new Date(),
        })
        .where(eq(nodeInstallation.id, job.id));
    }
    return;
  }
  const node = await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, job.nodeId) });
  if (!node?.encryptedAgentToken)
    throw new Error('Cannot verify this node’s installation identity.');
  const token = decrypt(node.encryptedAgentToken),
    controlId = createHash('sha256').update(token).digest('hex');
  const credentials = job.encryptedCredentials ? JSON.parse(decrypt(job.encryptedCredentials)) : {};
  const secrets = [
    token,
    ...(Object.values(credentials).filter((v) => typeof v === 'string') as string[]),
  ];
  const clean = (value: string) => {
    let text = value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    for (const secret of secrets)
      if (secret.length > 3) text = text.replaceAll(secret, '[redacted]');
    return text.slice(0, 2000);
  };
  let logs = [...job.logs];
  let stage = 'Connecting to uninstall this node';
  let machine: string | undefined;
  let proof: string | undefined;
  let removed = false;
  let pending: Promise<unknown> = Promise.resolve();
  const log = (line: string) => {
    const message = clean(line);
    if (!message.trim()) return;
    if (message.startsWith('IRL_MACHINE:'))
      machine = createHash('sha256').update(message.slice(12).trim()).digest('hex');
    if (message.startsWith('IRL_PROOF:')) proof = message.slice(10);
    if (message === 'IRL_REMOVED') removed = true;
    if (message.startsWith('IRL_STEP:')) stage = message.slice(9);
    logs = [
      ...logs,
      { at: new Date().toISOString(), message: message.replace(/^IRL_STEP:/, '') },
    ].slice(-500);
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
  let directory: string | undefined;
  try {
    await db
      .update(nodeInstallation)
      .set({ status: 'removing', error: null, updatedAt: new Date() })
      .where(eq(nodeInstallation.id, job.id));
    const script = await readFile(path.join(source, 'installer/uninstall.sh'), 'utf8');
    let run: (phase: 'verify' | 'apply', allow: boolean) => Promise<void>;
    if (job.mode === 'local') {
      if (process.env.ENABLE_LOCAL_INSTALL !== '1')
        throw new Error('Local node operations are disabled on this installer.');
      directory = await mkdtemp(path.join(root, 'removal-'));
      const file = path.join(directory, 'uninstall.sh');
      await writeFile(file, script, { mode: 0o700 });
      run = (phase, allow) =>
        localExec(
          'sh',
          [file, job.nodeId, controlId, job.id, phase, allow ? '1' : '0', 'local'],
          log,
          { ...process.env, IRL_INSTALL_ROOT: path.join(root, 'local-node') },
        );
    } else {
      if (!job.fingerprint || (!credentials.privateKey && !credentials.password))
        throw new Error(
          'SSH credentials and the original host fingerprint are required for remote removal.',
        );
      client = await sshConnect(
        {
          host: job.config.sshHost,
          port: job.config.sshPort,
          username: job.config.sshUser,
          ...credentials,
        },
        job.fingerprint,
      );
      run = (phase, allow) =>
        sshExec(
          client!,
          `${job.config.sshUser === 'root' ? '' : 'sudo -n '}sh -s -- ${job.nodeId} ${controlId} ${job.id} ${phase} ${allow ? '1' : '0'} ssh`,
          script,
          log,
        );
    }
    log('Verifying machine identity before deleting any resources.');
    await persist();
    await run('verify', !!job.removalVerifiedAt);
    if (node.machineId && machine !== node.machineId)
      throw new Error('This is a different Docker host. Nothing was deleted.');
    if (!machine || !proof)
      throw new Error('Remote ownership could not be established. Node data has been preserved.');
    await db
      .update(nodeInstallation)
      .set({ removalVerifiedAt: job.removalVerifiedAt ?? new Date() })
      .where(eq(nodeInstallation.id, job.id));
    await run('apply', true);
    if (!removed) throw new Error('The remote host did not confirm that uninstall finished.');
    clearInterval(timer);
    await persist();
    await db
      .update(nodeInstallation)
      .set({
        remoteRemovedAt: new Date(),
        status: 'remote_removed',
        step: 'Deleting node application data',
        encryptedCredentials: null,
        updatedAt: new Date(),
      })
      .where(eq(nodeInstallation.id, job.id));
    await deleteNodeData(job.nodeId, job.workspaceId);
  } catch (error) {
    clearInterval(timer);
    const message = clean(error instanceof Error ? error.message : 'Node removal failed.');
    log(message);
    await persist().catch(() => {});
    await db
      .update(nodeInstallation)
      .set({ status: 'remove_failed', error: message, logs, updatedAt: new Date() })
      .where(eq(nodeInstallation.id, job.id));
  } finally {
    clearInterval(timer);
    client?.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
