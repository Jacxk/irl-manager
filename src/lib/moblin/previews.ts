import { and, eq, inArray, isNotNull, isNull, asc } from 'drizzle-orm';
import { db } from '../db';
import { channel, mediaServer, member, moblinPairing, user } from '../db/schema';
import type { Settings } from '../settings-registry';
export async function moblinPreviews(nodeIds: string[], settings: Settings) {
  const selected = new Map<
    string,
    {
      sessionId: string;
      state: string;
      updatedAt: Date | null;
      startedAt: Date | null;
      lastFrameAt: Date | null;
    }
  >();
  const queued = new Set<string>();
  if (
    !nodeIds.length ||
    !settings.allowMoblinControl ||
    !settings.allowPreLivePreview ||
    !settings.maxMoblinPreviewPrograms
  )
    return { selected, queued };
  const requests = await db
    .select({
      id: channel.id,
      nodeId: channel.serverId,
      sessionId: moblinPairing.previewSessionId,
      state: moblinPairing.previewState,
      startedAt: moblinPairing.previewStartedAt,
      lastFrameAt: moblinPairing.previewLastFrameAt,
      updatedAt: moblinPairing.previewUpdatedAt,
    })
    .from(moblinPairing)
    .innerJoin(
      channel,
      and(
        eq(channel.id, moblinPairing.channelId),
        eq(channel.workspaceId, moblinPairing.workspaceId),
      ),
    )
    .innerJoin(mediaServer, eq(mediaServer.id, channel.serverId))
    .innerJoin(
      member,
      and(
        eq(member.userId, moblinPairing.pairedBy),
        eq(member.workspaceId, moblinPairing.workspaceId),
        inArray(member.role, ['owner', 'admin']),
      ),
    )
    .innerJoin(user, and(eq(user.id, moblinPairing.pairedBy), eq(user.active, true)))
    .where(
      and(
        inArray(channel.serverId, nodeIds),
        eq(channel.desired, 'stopped'),
        eq(moblinPairing.enabled, true),
        eq(moblinPairing.lastStreaming, true),
        isNotNull(moblinPairing.previewSessionId),
        isNull(mediaServer.removalRequestedAt),
      ),
    )
    .orderBy(asc(moblinPairing.previewStartedAt), asc(channel.id));
  const counts = new Map<string, number>();
  for (const request of requests) {
    const count = counts.get(request.nodeId) ?? 0;
    if (count >= settings.maxMoblinPreviewPrograms) {
      queued.add(request.id);
      continue;
    }
    counts.set(request.nodeId, count + 1);
    selected.set(request.id, {
      sessionId: request.sessionId!,
      state: request.state,
      startedAt: request.startedAt,
      lastFrameAt: request.lastFrameAt,
      updatedAt: request.updatedAt,
    });
  }
  return { selected, queued };
}
