import { lockWorkspaceAccess } from '@/lib/workspace-mutation';
import { readCommandBody } from '@/lib/request-body';
import { readSettings } from '@/lib/settings';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { mediaServer, nodeInstallation } from '@/lib/db/schema';
import { ApiError } from '@/lib/access';
import { encrypt, decrypt } from '@/lib/crypto';
import {
  installerAccess,
  apiFailure,
  validControlUrl,
  localNodeInstallationAllowed,
} from '@/lib/nodes/security';
const configSchema = z.object({
  name: z.string().trim().min(1).max(80),
  host: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9.-]+$/),
  region: z.string().trim().min(1).max(60),
  controlUrl: z.string().url(),
  sshHost: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9.-]*$/),
  sshPort: z.number().int().min(1).max(65535),
  sshUser: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/),
  sshAuth: z.enum(['key', 'password']).default('key'),
});
const draftSchema = configSchema.extend({
  name: z.string().trim().max(80),
  host: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9.-]*$/),
  region: z.string().trim().max(60),
  controlUrl: z.string().max(2000),
  sshUser: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$|^$/),
});
const credentialsSchema = z.object({
  password: z.string().max(2048).optional(),
  privateKey: z.string().max(32768).optional(),
  passphrase: z.string().max(2048).optional(),
});
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await installerAccess(request);
    const { id } = await params;
    const body = await readCommandBody(request);
    await db.transaction(async (tx) => {
      await lockWorkspaceAccess(tx, ctx);
      const target = await tx.query.nodeInstallation.findFirst({
        where: and(eq(nodeInstallation.id, id), eq(nodeInstallation.workspaceId, ctx.workspace.id)),
      });
      if (!target) throw new ApiError(404, 'Installation not found.');
      // Serialize setup changes with permanent removal using the same node lock.
      await tx
        .select({ id: mediaServer.id })
        .from(mediaServer)
        .where(eq(mediaServer.id, target.nodeId))
        .for('update');
      const job = await tx.query.nodeInstallation.findFirst({
        where: and(eq(nodeInstallation.id, id), eq(nodeInstallation.workspaceId, ctx.workspace.id)),
      });
      if (!job) throw new ApiError(404, 'Installation not found.');
      const { values: settings } = await readSettings();
      if (job.mode === 'ssh' && !settings.allowSshNodeInstallation)
        throw new ApiError(403, 'SSH node installation is disabled by instance policy.');
      if (job.operation === 'remove')
        throw new ApiError(409, 'This node is being removed. Use the removal dialog to retry.');
      if (job.mode === 'local' && !(await localNodeInstallationAllowed()))
        throw new ApiError(403, 'Local installation is disabled in Node operations settings.');
      if (body.action === 'save') {
        if (!['draft', 'awaiting_trust', 'failed'].includes(job.status))
          throw new ApiError(
            409,
            'Installation is running. Settings are locked until it finishes.',
          );
        const config = draftSchema.parse(body.config);
        if (
          job.startedAt &&
          (config.sshHost !== job.config.sshHost ||
            config.sshPort !== job.config.sshPort ||
            config.host !== job.config.host)
        )
          throw new ApiError(
            409,
            'An installation has started on this machine. Keep its host settings and retry.',
          );
        const credentials = credentialsSchema.parse(body.credentials ?? {});
        const saved = job.encryptedCredentials ? JSON.parse(decrypt(job.encryptedCredentials)) : {};
        if (config.sshAuth === 'password') {
          delete saved.privateKey;
          delete saved.passphrase;
        } else {
          delete saved.password;
        }
        for (const [key, value] of Object.entries(credentials)) if (value) saved[key] = value;
        const changedHost =
          config.sshHost !== job.config.sshHost || config.sshPort !== job.config.sshPort;
        const updated = await tx
          .update(nodeInstallation)
          .set({
            config,
            encryptedCredentials: Object.keys(saved).length ? encrypt(JSON.stringify(saved)) : null,
            ...(changedHost ? { fingerprint: null, status: 'draft', step: 'configure' } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(nodeInstallation.id, id),
              inArray(nodeInstallation.status, ['draft', 'awaiting_trust', 'failed']),
            ),
          )
          .returning({ id: nodeInstallation.id });
        if (!updated.length)
          throw new ApiError(409, 'Installation has started. Connection settings are locked.');
        await tx
          .update(mediaServer)
          .set({
            name: config.name || 'New node',
            host: config.host || 'unconfigured',
            region: config.region || 'Remote',
          })
          .where(eq(mediaServer.id, job.nodeId));
      } else if (body.action === 'check') {
        if (!['draft', 'failed', 'awaiting_trust'].includes(job.status))
          throw new ApiError(409, 'This installation is already running.');
        configSchema.parse(job.config);
        try {
          validControlUrl(job.config.controlUrl, job.mode);
        } catch (e) {
          throw new ApiError(400, (e as Error).message);
        }
        if (job.mode === 'ssh' && (!job.config.sshHost || !job.encryptedCredentials))
          throw new ApiError(400, 'Provide the SSH host and a password or private key.');
        await tx
          .update(nodeInstallation)
          .set({
            status: job.mode === 'ssh' ? 'queued_check' : 'queued_install',
            step: job.mode === 'ssh' ? 'verify' : 'install',
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(nodeInstallation.id, id));
      } else if (body.action === 'edit') {
        if (job.status !== 'awaiting_trust')
          throw new ApiError(409, 'Connection settings can be edited before installation starts.');
        await tx
          .update(nodeInstallation)
          .set({ status: 'draft', step: 'configure', fingerprint: null, updatedAt: new Date() })
          .where(eq(nodeInstallation.id, id));
      } else if (body.action === 'trust') {
        if (job.status !== 'awaiting_trust' || !job.fingerprint)
          throw new ApiError(409, 'Check the host key first.');
        try {
          validControlUrl(job.config.controlUrl, job.mode);
        } catch (error) {
          throw new ApiError(400, (error as Error).message);
        }
        await tx
          .update(nodeInstallation)
          .set({ status: 'queued_install', step: 'install', error: null, updatedAt: new Date() })
          .where(eq(nodeInstallation.id, id));
      } else if (body.action === 'discard') {
        if (!['draft', 'failed', 'awaiting_trust'].includes(job.status) || job.startedAt)
          throw new ApiError(409, 'An installed or running node cannot be discarded here.');
        // Never remove an installed machine claim or a node with channels.
        const assigned = await tx.query.channel.findFirst({
          where: (await import('drizzle-orm')).eq(
            (await import('@/lib/db/schema')).channel.serverId,
            job.nodeId,
          ),
        });
        const node = await tx.query.mediaServer.findFirst({
          where: eq(mediaServer.id, job.nodeId),
        });
        if (assigned || node?.machineId)
          throw new ApiError(
            409,
            'This node is already installed or assigned to a channel. Retry its setup instead.',
          );
        await tx.delete(mediaServer).where(eq(mediaServer.id, job.nodeId));
      } else throw new ApiError(400, 'Unknown installation action.');
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: e.issues[0].message }, { status: 400 });
    return apiFailure(e);
  }
}
