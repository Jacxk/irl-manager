import { and, eq, inArray, lt, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { channel, destination, mediaServer, nodePreview } from '@/lib/db/schema';
import { decrypt } from '@/lib/crypto';
import { nodeAuth, apiFailure } from '@/lib/nodes/security';
import { ApiError } from '@/lib/access';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const node = await nodeAuth(request);
    const instance = z.string().uuid().parse(request.headers.get('x-node-instance'));
    const now = new Date();
    const claimed = await db
      .update(mediaServer)
      .set({
        agentInstance: instance,
        agentLeaseAt: now,
        ...(request.headers.get('x-media-ready') === '1' ? { heartbeatAt: now } : {}),
      })
      .where(
        and(
          eq(mediaServer.id, node.id),
          or(
            eq(mediaServer.agentInstance, instance),
            isNull(mediaServer.agentLeaseAt),
            lt(mediaServer.agentLeaseAt, new Date(Date.now() - 20000)),
          ),
        ),
      )
      .returning({ id: mediaServer.id });
    if (!claimed.length) throw new ApiError(409, 'Another agent is active for this node.');
    const channels = await db.select().from(channel).where(eq(channel.serverId, node.id));
    const targets = channels.length
      ? await db
          .select()
          .from(destination)
          .where(
            inArray(
              destination.channelId,
              channels.map((c) => c.id),
            ),
          )
      : [];
    await db
      .delete(nodePreview)
      .where(and(eq(nodePreview.nodeId, node.id), lt(nodePreview.expiresAt, now)));
    const previews = await db
      .select({ id: nodePreview.id, path: nodePreview.path })
      .from(nodePreview)
      .where(and(eq(nodePreview.nodeId, node.id), isNull(nodePreview.status)));
    return Response.json(
      {
        channels,
        destinations: targets.map(({ encryptedKey, ...d }) => ({
          ...d,
          streamKey: decrypt(encryptedKey),
        })),
        previews,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
