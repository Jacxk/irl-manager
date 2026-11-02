import { readCommandBody } from '@/lib/request-body';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { channel, destination, event, moblinPairing } from '@/lib/db/schema';
import { nodeAuth, apiFailure } from '@/lib/nodes/security';
import { ApiError } from '@/lib/access';
const change = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('preview'),
    id: z.string().uuid(),
    previewSessionId: z.string().uuid(),
    state: z.enum(['starting', 'live', 'degraded', 'fallback', 'recovering', 'ended']),
    lastFrameAt: z.string().datetime().nullable(),
    finished: z.boolean(),
  }),
  z.object({
    type: z.literal('channel'),
    id: z.string().uuid(),
    sessionId: z.string().uuid().nullable(),
    state: z.enum(['starting', 'live', 'degraded', 'fallback', 'recovering', 'ended']),
    lastFrameAt: z.string().datetime().nullable().optional(),
    endReason: z.enum(['intentional', 'timeout', 'worker_error']).optional(),
  }),
  z.object({
    type: z.literal('destination'),
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    sessionId: z.string().uuid().nullable(),
    status: z.enum(['idle', 'connecting', 'connected', 'retrying']),
    retries: z.number().int().min(0).max(100000).optional(),
    lastError: z.string().max(300).nullable().optional(),
  }),
  z.object({
    type: z.literal('event'),
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    sessionId: z.string().uuid().nullable(),
    kind: z.enum(['session', 'health']),
    message: z.string().max(500),
  }),
]);
export async function POST(request: Request) {
  try {
    const node = await nodeAuth(request);
    if (node.agentInstance !== request.headers.get('x-node-instance'))
      throw new ApiError(409, 'Agent lease lost.');
    const { changes } = z
      .object({ changes: z.array(change).max(250) })
      .parse(await readCommandBody(request));
    await db.transaction(async (tx) => {
      const owned = await tx
        .select()
        .from(channel)
        .where(eq(channel.serverId, node.id))
        .for('update');
      const channels = new Map(owned.map((c) => [c.id, c]));
      for (const item of changes) {
        const c = channels.get(
          item.type === 'channel' || item.type === 'preview' ? item.id : item.channelId,
        );
        if (item.type === 'preview') {
          if (c)
            await tx
              .update(moblinPairing)
              .set({
                previewState: item.state,
                previewLastFrameAt: item.lastFrameAt ? new Date(item.lastFrameAt) : null,
                previewUpdatedAt: new Date(),
                ...(item.finished ? { previewSessionId: null } : {}),
              })
              .where(
                and(
                  eq(moblinPairing.channelId, c.id),
                  eq(moblinPairing.previewSessionId, item.previewSessionId),
                ),
              );
          continue;
        }
        if (!c || c.sessionId !== item.sessionId) continue;
        if (
          c.desired === 'stopped' &&
          ((item.type === 'channel' && item.state !== 'ended') ||
            (item.type === 'destination' && item.status !== 'idle'))
        )
          continue;
        if (item.type === 'channel')
          await tx
            .update(channel)
            .set({
              state: item.state,
              ...(item.lastFrameAt !== undefined
                ? { lastFrameAt: item.lastFrameAt ? new Date(item.lastFrameAt) : null }
                : {}),
              ...(item.state === 'ended'
                ? {
                    desired: 'stopped',
                    endedAt: new Date(),
                    endReason:
                      c.desired === 'stopped'
                        ? (c.endReason ?? item.endReason ?? 'worker_error')
                        : (item.endReason ?? 'worker_error'),
                    manualFallback: false,
                  }
                : {}),
            })
            .where(
              and(
                eq(channel.id, c.id),
                eq(channel.serverId, node.id),
                item.sessionId ? eq(channel.sessionId, item.sessionId) : inArray(channel.id, []),
              ),
            );
        if (item.type === 'destination')
          await tx
            .update(destination)
            .set({
              status: item.status,
              ...(item.retries !== undefined ? { retries: item.retries } : {}),
              lastError: item.lastError ?? null,
              updatedAt: new Date(),
            })
            .where(and(eq(destination.id, item.id), eq(destination.channelId, c.id)));
        if (item.type === 'event') await tx.insert(event).values(item).onConflictDoNothing();
      }
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: 'Invalid agent report.' }, { status: 400 });
    return apiFailure(e);
  }
}
