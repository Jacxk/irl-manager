import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireChannel, ApiError } from '@/lib/access';
import { lockWorkspaceAccess } from '@/lib/workspace-mutation';
import { readSettings } from '@/lib/settings';
import { readCommandBody } from '@/lib/request-body';
import { db } from '@/lib/db';
import { adminAudit, channel, mediaServer, moblinPairing, serviceHeartbeat } from '@/lib/db/schema';
import { encrypt } from '@/lib/crypto';
import { moblinEndpoint } from '@/lib/moblin/protocol';
export const dynamic = 'force-dynamic';
const command = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    revision: z.number().int().min(0),
    enabled: z.boolean(),
    syncBroadcast: z.boolean(),
    lowBitrateKbps: z.number().int().min(0).max(100000),
    lowBitrateSeconds: z.number().int().min(2).max(60),
    recoverySeconds: z.number().int().min(2).max(60),
  }),
  z.object({ action: z.literal('rotate'), revision: z.number().int().min(1) }),
]);
function fail(e: unknown) {
  if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof z.ZodError)
    return Response.json({ error: e.issues[0].message }, { status: 400 });
  return Response.json(
    { error: 'Moblin setup failed. Check service configuration.' },
    { status: 500 },
  );
}
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireChannel((await params).id);
    const { values } = await readSettings();
    const row = await db.query.moblinPairing.findFirst({
      where: eq(moblinPairing.channelId, ctx.channel.id),
    });
    const heartbeat = await db.query.serviceHeartbeat.findFirst({
      where: eq(serviceHeartbeat.id, 'moblin'),
    });
    let endpoint = '',
      endpointError: string | undefined;
    try {
      endpoint = moblinEndpoint(values.publicUrl, values.moblinPublicUrl, ctx.channel.id);
    } catch {
      endpointError =
        'Configure an HTTPS public application URL in Admin → General, or a WSS gateway override in Admin → Moblin.';
    }
    return Response.json(
      {
        allowed: values.allowMoblinControl,
        gatewayReady: !!heartbeat && Date.now() - heartbeat.at.getTime() < 15000,
        endpoint,
        endpointError,
        revision: row?.revision ?? 0,
        config: {
          enabled: row?.enabled ?? false,
          syncBroadcast: row?.syncBroadcast ?? false,
          lowBitrateKbps: row?.lowBitrateKbps ?? values.moblinDefaultLowBitrateKbps,
          lowBitrateSeconds: row?.lowBitrateSeconds ?? values.moblinDefaultLowBitrateSeconds,
          recoverySeconds: row?.recoverySeconds ?? values.moblinDefaultRecoverySeconds,
        },
        connected:
          values.allowMoblinControl &&
          !!row?.enabled &&
          !!row.connectionId &&
          !!row.lastSeenAt &&
          Date.now() - row.lastSeenAt.getTime() < 15000,
        streaming: row?.lastStreaming ?? null,
        bitrateKbps: row?.bitrateKbps ?? null,
        lastError: row?.lastError ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireChannel((await params).id);
    if (!['owner', 'admin'].includes(ctx.membership.role))
      throw new ApiError(403, 'Workspace administrator access required.');
    const { values } = await readSettings();
    if (request.headers.get('origin') !== values.publicUrl)
      throw new ApiError(403, 'Invalid request origin.');
    const cmd = command.parse(await readCommandBody(request));
    if (!values.allowMoblinControl && (cmd.action === 'rotate' || cmd.enabled))
      throw new ApiError(403, 'Moblin control is disabled by instance policy.');
    let password: string | undefined;
    await db.transaction(async (tx) => {
      await lockWorkspaceAccess(tx, ctx);
      const [c] = await tx
        .select()
        .from(channel)
        .where(and(eq(channel.id, ctx.channel.id), eq(channel.workspaceId, ctx.workspace.id)))
        .for('update');
      if (!c) throw new ApiError(404, 'Channel not found.');
      const node = await tx.query.mediaServer.findFirst({ where: eq(mediaServer.id, c.serverId) });
      if (node?.removalRequestedAt)
        throw new ApiError(409, 'This node is being permanently removed.');
      const existing = await tx.query.moblinPairing.findFirst({
        where: eq(moblinPairing.channelId, c.id),
      });
      if ((existing?.revision ?? 0) !== cmd.revision)
        throw new ApiError(409, 'Moblin setup changed. Cancel changes to reload current settings.');
      if (cmd.action === 'rotate' && !existing) throw new ApiError(409, 'Save Moblin setup first.');
      if (!existing || cmd.action === 'rotate' || existing.pairedBy !== ctx.user.id)
        password = randomBytes(24).toString('base64url');
      const config =
        cmd.action === 'save'
          ? {
              enabled: cmd.enabled,
              syncBroadcast: cmd.syncBroadcast,
              lowBitrateKbps: cmd.lowBitrateKbps,
              lowBitrateSeconds: cmd.lowBitrateSeconds,
              recoverySeconds: cmd.recoverySeconds,
            }
          : {};
      const encryptedPassword = password ? encrypt(password) : existing!.encryptedPassword;
      await tx
        .insert(moblinPairing)
        .values({
          channelId: c.id,
          workspaceId: ctx.workspace.id,
          pairedBy: ctx.user.id,
          encryptedPassword,
          ...config,
        })
        .onConflictDoUpdate({
          target: moblinPairing.channelId,
          set: {
            ...config,
            pairedBy: ctx.user.id,
            encryptedPassword,
            revision: (existing?.revision ?? 0) + 1,
            connectionId: null,
            lastSeenAt: null,
            lastStreaming: null,
            previewSessionId: null,
            previewStartedAt: null,
            previewState: 'idle',
            previewLastFrameAt: null,
            previewUpdatedAt: null,
            bitrateAt: null,
            bitrateKbps: null,
            lowSince: null,
            healthySince: null,
            lowBitrateActive: false,
            lastError: null,
          },
        });
      await tx.insert(adminAudit).values({
        id: randomUUID(),
        actorId: ctx.user.id,
        target: c.id,
        action: `moblin.${cmd.action}`,
      });
    });
    return Response.json(
      { ok: true, ...(password ? { password } : {}) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return fail(e);
  }
}
