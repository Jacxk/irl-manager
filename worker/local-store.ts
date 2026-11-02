import { moblinPreviews } from '../src/lib/moblin/previews';
import { moblinFallbackActive } from '../src/lib/moblin/protocol';
import { readSettings } from '../src/lib/settings';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { channel, destination, event, mediaServer, moblinPairing } from '../src/lib/db/schema';
import { decrypt } from '../src/lib/crypto';
import type { Store } from './store';
export async function localStore(nodeId: string): Promise<Store> {
  const lock = await sql.reserve();
  const [held] = await lock`select pg_try_advisory_lock(hashtext(${nodeId})) as locked`;
  if (!held.locked) throw new Error('Another worker already owns this node.');
  if (!(await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, nodeId) })))
    throw new Error('Add this node in the dashboard first.');
  return {
    async load() {
      await db
        .update(mediaServer)
        .set({ heartbeatAt: new Date() })
        .where(eq(mediaServer.id, nodeId));
      const channels = await db.select().from(channel).where(eq(channel.serverId, nodeId));
      const destinations = await db
        .select()
        .from(destination)
        .where(
          (await import('drizzle-orm')).inArray(
            destination.channelId,
            channels.map((c) => c.id),
          ),
        );
      const { values } = await readSettings();
      const pairings = values.allowMoblinControl
        ? await db
            .select()
            .from(moblinPairing)
            .where(
              (await import('drizzle-orm')).inArray(
                moblinPairing.channelId,
                channels.map((c) => c.id),
              ),
            )
        : [];
      const previews = await moblinPreviews([nodeId], values);
      return {
        channels: channels.map((c) => ({
          ...c,
          previewSessionId: previews.selected.get(c.id)?.sessionId ?? null,
          previewStartedAt: previews.selected.get(c.id)?.startedAt ?? null,
          previewLastFrameAt: previews.selected.get(c.id)?.lastFrameAt ?? null,
          automaticFallback: pairings.some((p) => p.channelId === c.id && moblinFallbackActive(p)),
        })),
        destinations,
      };
    },
    async preview(c, sessionId, patch) {
      await db
        .update(moblinPairing)
        .set({
          previewState: patch.state,
          previewLastFrameAt: patch.lastFrameAt,
          previewUpdatedAt: new Date(),
          ...(patch.finished ? { previewSessionId: null } : {}),
        })
        .where(
          and(eq(moblinPairing.channelId, c.id), eq(moblinPairing.previewSessionId, sessionId)),
        );
    },
    async channel(c, patch) {
      await db
        .update(channel)
        .set(patch)
        .where(
          and(
            eq(channel.id, c.id),
            c.sessionId ? eq(channel.sessionId, c.sessionId) : eq(channel.desired, 'stopped'),
            ...(patch.state !== 'ended' ? [eq(channel.desired, 'running')] : []),
          ),
        );
    },
    async destination(d, _sessionId, patch) {
      await db
        .update(destination)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(destination.id, d.id));
    },
    async event(c, kind, message) {
      await db
        .insert(event)
        .values({ id: randomUUID(), channelId: c.id, sessionId: c.sessionId, kind, message });
    },
    async key(d) {
      return decrypt(d.encryptedKey);
    },
    async flush() {},
    async close() {
      await db.update(mediaServer).set({ heartbeatAt: null }).where(eq(mediaServer.id, nodeId));
      lock.release();
      await sql.end();
    },
  };
}
