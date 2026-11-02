import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { channel, destination, event, mediaServer } from './db/schema';
import { ApiError } from './api-error';
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Caller must hold the channel row lock and current workspace authorization. */
export async function changeBroadcast(
  tx: Transaction,
  c: typeof channel.$inferSelect,
  action: 'start' | 'stop',
) {
  if (action === 'stop') {
    await tx
      .update(channel)
      .set({ desired: 'stopped', state: 'ending', endReason: 'intentional' })
      .where(and(eq(channel.id, c.id), eq(channel.desired, 'running')));
    return;
  }
  const target = await tx.query.destination.findFirst({
    where: and(eq(destination.channelId, c.id), eq(destination.enabled, true)),
  });
  if (!target)
    throw new ApiError(400, 'Add and enable at least one destination before starting a broadcast.');
  const node = await tx.query.mediaServer.findFirst({ where: eq(mediaServer.id, c.serverId) });
  if (node?.removalRequestedAt) throw new ApiError(409, 'This node is being permanently removed.');
  if (!node?.heartbeatAt || Date.now() - node.heartbeatAt.getTime() > 15000)
    throw new ApiError(409, 'This node is offline. Start its media worker before going live.');
  const [started] = await tx
    .update(channel)
    .set({
      desired: 'running',
      state: 'starting',
      sessionId: randomUUID(),
      startedAt: new Date(),
      endedAt: null,
      endReason: null,
      manualFallback: false,
      lastFrameAt: null,
    })
    .where(and(eq(channel.id, c.id), eq(channel.desired, 'stopped')))
    .returning();
  if (started)
    await tx.insert(event).values({
      id: randomUUID(),
      channelId: c.id,
      sessionId: started.sessionId,
      kind: 'session',
      message: 'Session requested. Starting all enabled destinations.',
    });
}
