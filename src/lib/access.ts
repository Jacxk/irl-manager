import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { auth } from './auth';
import { db } from './db';
import { member, workspace } from './db/schema';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function access() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new ApiError(401, 'Please sign in.');
  let membership = await db.query.member.findFirst({ where: eq(member.userId, session.user.id) });
  if (!membership) {
    await db.transaction(async (tx) => {
      // Serialize first-login workspace creation across requests.
      const { sql } = await import('drizzle-orm');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.user.id}))`);
      const existing = await tx.query.member.findFirst({
        where: eq(member.userId, session.user.id),
      });
      if (existing) return;
      const id = randomUUID();
      await tx
        .insert(workspace)
        .values({ id, name: `${session.user.name.split(' ')[0]}'s workspace` });
      await tx
        .insert(member)
        .values({ id: randomUUID(), workspaceId: id, userId: session.user.id, role: 'owner' });
    });
    membership = await db.query.member.findFirst({ where: eq(member.userId, session.user.id) });
  }
  if (!membership) throw new ApiError(403, 'No workspace access.');
  const ws = await db.query.workspace.findFirst({
    where: eq(workspace.id, membership.workspaceId),
  });
  return { user: session.user, membership, workspace: ws! };
}
export async function requireChannel(id: string) {
  const ctx = await access();
  const { channel } = await import('./db/schema');
  const found = await db.query.channel.findFirst({
    where: and(eq(channel.id, id), eq(channel.workspaceId, ctx.membership.workspaceId)),
  });
  if (!found) throw new ApiError(404, 'Channel not found.');
  const { mediaServer } = await import('./db/schema');
  const node = await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, found.serverId) });
  if (node?.removalRequestedAt) throw new ApiError(409, 'This node is being permanently removed.');
  return { ...ctx, channel: found };
}
