import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { channel, mediaServer, member, moblinPairing, user } from '../db/schema';
import { ApiError } from '../api-error';
import { changeBroadcast, type Transaction } from '../broadcast';
import { readSettings } from '../settings';
import { nextMoblinBitrate } from './protocol';

/** Match the pairing creator's current permissions, never a stale session snapshot. */
export async function lockMoblinBinding(tx: Transaction, id: string, connectionId?: string) {
  const original = await tx.query.moblinPairing.findFirst({
    where: eq(moblinPairing.channelId, id),
  });
  if (!original?.enabled || !original.pairedBy)
    throw new ApiError(403, 'Moblin pairing is disabled.');
  const [membership] = await tx
    .select()
    .from(member)
    .where(
      and(
        eq(member.userId, original.pairedBy),
        eq(member.workspaceId, original.workspaceId),
        inArray(member.role, ['owner', 'admin']),
      ),
    )
    .for('share');
  const [actor] = await tx.select().from(user).where(eq(user.id, original.pairedBy)).for('share');
  if (!membership || !actor?.active)
    throw new ApiError(
      403,
      'Pairing owner no longer has workspace access. Pair again as an administrator.',
    );
  const [c] = await tx
    .select()
    .from(channel)
    .where(and(eq(channel.id, id), eq(channel.workspaceId, original.workspaceId)))
    .for('update');
  const [pairing] = await tx
    .select()
    .from(moblinPairing)
    .where(eq(moblinPairing.channelId, id))
    .for('update');
  if (
    !c ||
    !pairing?.enabled ||
    pairing.revision !== original.revision ||
    pairing.pairedBy !== original.pairedBy
  )
    throw new ApiError(409, 'Moblin pairing changed. Reconnect.');
  if (connectionId && pairing.connectionId !== connectionId)
    throw new ApiError(409, 'Another Moblin connection owns this pairing.');
  const node = await tx.query.mediaServer.findFirst({ where: eq(mediaServer.id, c.serverId) });
  if (node?.removalRequestedAt) throw new ApiError(409, 'This node is being permanently removed.');
  return { pairing, c };
}
export async function claimMoblin(id: string, revision: number) {
  const { values } = await readSettings();
  if (!values.allowMoblinControl)
    throw new ApiError(403, 'Moblin control is disabled by instance policy.');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(839152004)`);
    const { pairing } = await lockMoblinBinding(tx, id);
    if (pairing.revision !== revision) throw new ApiError(409, 'Pairing credentials changed.');
    const cutoff = new Date(Date.now() - 15000);
    if (pairing.connectionId && pairing.lastSeenAt && pairing.lastSeenAt > cutoff)
      throw new ApiError(409, 'A phone is already connected to this channel.');
    const active = await tx
      .select({ id: moblinPairing.channelId })
      .from(moblinPairing)
      .where(
        and(
          eq(moblinPairing.enabled, true),
          isNotNull(moblinPairing.connectionId),
          gt(moblinPairing.lastSeenAt, cutoff),
        ),
      );
    if (active.length >= values.maxMoblinConnections)
      throw new ApiError(429, 'Instance Moblin connection limit reached.');
    const connectionId = randomUUID();
    await tx
      .update(moblinPairing)
      .set({
        connectionId,
        lastSeenAt: new Date(),
        lastError: null,
        lowSince: null,
        healthySince: null,
        lowBitrateActive: false,
        bitrateAt: null,
        bitrateKbps: null,
      })
      .where(eq(moblinPairing.channelId, id));
    return connectionId;
  });
}
export async function updateMoblin(
  id: string,
  connectionId: string,
  revision: number,
  input: { streaming?: boolean; kbps?: number } = {},
) {
  const { values } = await readSettings();
  if (!values.allowMoblinControl)
    throw new ApiError(403, 'Moblin control is disabled by instance policy.');
  return db.transaction(async (tx) => {
    const { pairing, c } = await lockMoblinBinding(tx, id, connectionId);
    if (pairing.revision !== revision)
      throw new ApiError(409, 'Pairing configuration changed. Reconnect.');
    const now = new Date();
    const preview =
      input.streaming === false
        ? {
            previewSessionId: null,
            previewStartedAt: null,
            previewState: 'idle',
            previewLastFrameAt: null,
            previewUpdatedAt: null,
          }
        : input.streaming === true &&
            !pairing.previewSessionId &&
            values.allowPreLivePreview &&
            values.maxMoblinPreviewPrograms > 0
          ? {
              previewSessionId: randomUUID(),
              previewStartedAt: now,
              previewState: 'starting',
              previewLastFrameAt: null,
              previewUpdatedAt: null,
            }
          : {};
    await tx
      .update(moblinPairing)
      .set({
        ...preview,
        lastSeenAt: now,
        ...(input.kbps !== undefined
          ? {
              bitrateKbps: input.kbps,
              bitrateAt: now,
              ...nextMoblinBitrate(pairing, input.kbps, now),
            }
          : {}),
        ...(input.streaming !== undefined ? { lastStreaming: input.streaming } : {}),
      })
      .where(eq(moblinPairing.channelId, id));
    // Initial state is a snapshot, not a start command. A false snapshot after a
    // previously-live phone reconnects is an intentional stop we missed offline.
    if (
      pairing.syncBroadcast &&
      input.streaming !== undefined &&
      pairing.lastStreaming !== null &&
      pairing.lastStreaming !== input.streaming
    ) {
      try {
        await tx.transaction(async (nested) =>
          changeBroadcast(nested, c, input.streaming ? 'start' : 'stop'),
        );
        await tx
          .update(moblinPairing)
          .set({ lastError: null })
          .where(eq(moblinPairing.channelId, id));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        await tx
          .update(moblinPairing)
          .set({ lastError: error.message })
          .where(eq(moblinPairing.channelId, id));
      }
    }
  });
}
export async function releaseMoblin(id: string, connectionId: string) {
  // Losing transport must never be converted into a Stop command.
  await db
    .update(moblinPairing)
    .set({
      connectionId: null,
      lowSince: null,
      healthySince: null,
      lowBitrateActive: false,
      bitrateAt: null,
    })
    .where(and(eq(moblinPairing.channelId, id), eq(moblinPairing.connectionId, connectionId)));
}
