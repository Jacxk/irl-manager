import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, sql } from '../src/lib/db';
import { channel, destination, event, mediaServer } from '../src/lib/db/schema';
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
      return { channels, destinations };
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
