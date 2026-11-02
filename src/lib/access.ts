import { developmentAccountAllowed } from './development';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getAuth } from './auth';
import { db } from './db';
import { member, workspace, user } from './db/schema';
import { ApiError } from './api-error';
export { ApiError } from './api-error';
export async function access() {
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  if (!session || !developmentAccountAllowed(session.user.id))
    throw new ApiError(401, 'Please sign in.');
  const person = await db.query.user.findFirst({ where: eq(user.id, session.user.id) });
  if (!person?.active) throw new ApiError(403, 'This account is deactivated.');
  let membership = await db.query.member.findFirst({ where: eq(member.userId, session.user.id) });
  if (!membership) {
    const { values } = await (await import('./settings')).readSettings();
    if (!values.allowWorkspaceCreation && person.instanceRole !== 'admin')
      throw new ApiError(
        403,
        'Workspace creation is disabled. Ask an administrator for an invitation.',
      );
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
  return {
    user: { ...session.user, instanceRole: person.instanceRole },
    membership,
    workspace: ws!,
  };
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

export async function instanceAccess() {
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  if (!session || !developmentAccountAllowed(session.user.id))
    throw new ApiError(401, 'Please sign in.');
  const person = await db.query.user.findFirst({ where: eq(user.id, session.user.id) });
  if (!person?.active || person.instanceRole !== 'admin')
    throw new ApiError(403, 'Instance administrator access required.');
  return person;
}
