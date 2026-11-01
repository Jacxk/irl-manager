import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { mediaServer, nodeInstallation, channel, destination, event } from '@/lib/db/schema';
import { ApiError } from '@/lib/access';
import { encrypt, decrypt } from '@/lib/crypto';
import { installerAccess, apiFailure, localInstallAllowed } from '@/lib/nodes/security';
import { busyInstallationStatuses, deleteNodeData } from '@/lib/nodes/removal';
async function getNode(id: string, workspaceId: string) {
  const node = await db.query.mediaServer.findFirst({
    where: and(eq(mediaServer.id, id), eq(mediaServer.workspaceId, workspaceId)),
  });
  if (!node) throw new ApiError(404, 'Node not found.');
  const installation = await db.query.nodeInstallation.findFirst({
    where: eq(nodeInstallation.nodeId, id),
  });
  return { node, installation };
}
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await installerAccess();
    const { node, installation } = await getNode((await params).id, ctx.workspace.id);
    const ids = (
      await db.select({ id: channel.id }).from(channel).where(eq(channel.serverId, node.id))
    ).map((c) => c.id);
    const [destinations, events] = await Promise.all([
      ids.length
        ? db.select({ value: count() }).from(destination).where(inArray(destination.channelId, ids))
        : Promise.resolve([{ value: 0 }]),
      ids.length
        ? db.select({ value: count() }).from(event).where(inArray(event.channelId, ids))
        : Promise.resolve([{ value: 0 }]),
    ]);
    const neverInstalled =
      !!installation &&
      !installation.startedAt &&
      !busyInstallationStatuses.includes(installation.status);
    return Response.json(
      {
        node: { id: node.id, name: node.name, host: node.host },
        managed: !!installation,
        neverInstalled,
        canRemove:
          !!installation &&
          (neverInstalled ||
            !!installation.remoteRemovedAt ||
            installation.mode !== 'local' ||
            localInstallAllowed(ctx.user.email)),
        counts: {
          channels: ids.length,
          destinations: destinations[0].value,
          events: events[0].value,
        },
        installation: installation
          ? {
              id: installation.id,
              mode: installation.mode,
              status: installation.status,
              operation: installation.operation,
              step: installation.step,
              error: installation.error,
              logs: installation.logs,
              sshHost: installation.config.sshHost,
              sshPort: installation.config.sshPort,
              sshUser: installation.config.sshUser,
              sshAuth: installation.config.sshAuth ?? 'key',
              fingerprint: installation.fingerprint,
              remoteCleaned: !!installation.remoteRemovedAt,
              hasCredentials: !!installation.encryptedCredentials,
            }
          : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiFailure(error);
  }
}
const requestSchema = z.object({
  confirmation: z.string(),
  permanent: z.literal(true),
  credentials: z
    .object({
      username: z
        .string()
        .regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/)
        .optional(),
      method: z.enum(['key', 'password']).default('key'),
      password: z.string().max(2048).optional(),
      privateKey: z.string().max(32768).optional(),
      passphrase: z.string().max(2048).optional(),
    })
    .optional(),
});
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await installerAccess(request);
    const id = (await params).id;
    const body = requestSchema.parse(await request.json());
    let immediate = false;
    await db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(mediaServer)
        .where(and(eq(mediaServer.id, id), eq(mediaServer.workspaceId, ctx.workspace.id)))
        .for('update');
      if (!node) throw new ApiError(404, 'Node not found.');
      if (body.confirmation !== node.name)
        throw new ApiError(400, 'Type the node name exactly to confirm permanent removal.');
      const installation = await tx.query.nodeInstallation.findFirst({
        where: eq(nodeInstallation.nodeId, id),
      });
      if (!installation)
        throw new ApiError(
          409,
          'Automatic permanent removal requires a managed installation. This manually registered node has no verifiable uninstall target.',
        );
      if (busyInstallationStatuses.includes(installation.status))
        throw new ApiError(409, 'Wait for the installation to finish before removing this node.');
      if (['queued_remove', 'removing', 'remote_removed'].includes(installation.status))
        throw new ApiError(409, 'Permanent removal is already in progress.');
      immediate = !installation.startedAt && installation.operation !== 'remove';
      if (
        !immediate &&
        !installation.remoteRemovedAt &&
        installation.mode === 'local' &&
        !localInstallAllowed(ctx.user.email)
      )
        throw new ApiError(
          403,
          'Local removal requires an administrator listed in LOCAL_INSTALL_ADMIN_EMAILS.',
        );
      let encryptedCredentials = installation.encryptedCredentials;
      if (!immediate && installation.mode === 'ssh' && !installation.remoteRemovedAt) {
        const saved: Record<string, string> = encryptedCredentials
          ? JSON.parse(decrypt(encryptedCredentials))
          : {};
        if (body.credentials) {
          if (body.credentials.method === 'password') {
            delete saved.privateKey;
            delete saved.passphrase;
          } else delete saved.password;
          for (const [key, value] of Object.entries(body.credentials))
            if (value && key !== 'method' && key !== 'username') saved[key] = value;
        }
        if (!saved.privateKey && !saved.password)
          throw new ApiError(400, 'Enter SSH credentials to uninstall the remote node.');
        if (!installation.fingerprint)
          throw new ApiError(
            409,
            'The original SSH host fingerprint is missing. Ownership cannot be verified.',
          );
        encryptedCredentials = encrypt(JSON.stringify(saved));
      }
      await tx
        .update(mediaServer)
        .set({ removalRequestedAt: node.removalRequestedAt ?? new Date() })
        .where(eq(mediaServer.id, id));
      await tx
        .update(channel)
        .set({ desired: 'stopped', state: 'ending', endReason: 'intentional' })
        .where(and(eq(channel.serverId, id), eq(channel.desired, 'running')));
      await tx
        .update(nodeInstallation)
        .set({
          operation: 'remove',
          remoteRemovedAt: immediate ? new Date() : installation.remoteRemovedAt,
          status: immediate
            ? 'remote_removed'
            : installation.remoteRemovedAt
              ? 'remote_removed'
              : 'queued_remove',
          step: immediate
            ? 'Deleting node data'
            : 'Waiting for the installer to uninstall this node',
          encryptedCredentials,
          error: null,
          config: {
            ...installation.config,
            sshUser: body.credentials?.username ?? installation.config.sshUser,
          },
          updatedAt: new Date(),
        })
        .where(eq(nodeInstallation.id, installation.id));
    });
    if (immediate) {
      await deleteNodeData(id, ctx.workspace.id);
      return Response.json({ removed: true });
    }
    return Response.json({ queued: true });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: error.issues[0].message }, { status: 400 });
    return apiFailure(error);
  }
}
