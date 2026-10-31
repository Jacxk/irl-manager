import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { access, ApiError, requireChannel } from '@/lib/access';
import { db } from '@/lib/db';
import {
  channel,
  destination,
  event,
  mediaServer,
  member,
  user,
  invitation,
  workspace,
} from '@/lib/db/schema';
import { encrypt } from '@/lib/crypto';
import { commandSchema } from '@/lib/validation';
export const dynamic = 'force-dynamic';
function fail(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError)
    return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
  console.error('Control operation failed:', error instanceof Error ? error.name : 'Unknown error');
  return NextResponse.json(
    { error: 'Operation failed. Check the application configuration and try again.' },
    { status: 500 },
  );
}
export async function GET() {
  try {
    const ctx = await access();
    const channels = await db
      .select()
      .from(channel)
      .where(eq(channel.workspaceId, ctx.workspace.id));
    const ids = channels.map((c) => c.id);
    const destinations = ids.length
      ? await db
          .select({
            id: destination.id,
            channelId: destination.channelId,
            name: destination.name,
            provider: destination.provider,
            url: destination.url,
            enabled: destination.enabled,
            status: destination.status,
            retries: destination.retries,
            lastError: destination.lastError,
          })
          .from(destination)
          .where(inArray(destination.channelId, ids))
      : [];
    const events = ids.length
      ? await db
          .select()
          .from(event)
          .where(inArray(event.channelId, ids))
          .orderBy(desc(event.createdAt))
          .limit(50)
      : [];
    const servers = await db
      .select()
      .from(mediaServer)
      .where(eq(mediaServer.workspaceId, ctx.workspace.id));
    const invitations = await db
      .select({ id: invitation.id, workspaceName: workspace.name, role: invitation.role })
      .from(invitation)
      .innerJoin(workspace, eq(invitation.workspaceId, workspace.id))
      .where(eq(invitation.userId, ctx.user.id));
    const members = await db
      .select({ id: member.id, role: member.role, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.workspaceId, ctx.workspace.id));
    return NextResponse.json(
      {
        user: ctx.user,
        workspace: ctx.workspace,
        role: ctx.membership.role,
        channels: channels.map((c) => ({ ...c, ingestKey: undefined })),
        destinations,
        events,
        servers: servers.map(({ id, name, host, region, heartbeatAt }) => ({
          id,
          name,
          host,
          region,
          heartbeatAt,
        })),
        members,
        invitations,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    if (
      request.headers.get('origin') !== new URL(process.env.BETTER_AUTH_URL ?? request.url).origin
    )
      throw new ApiError(403, 'Invalid request origin.');
    const cmd = commandSchema.parse(await request.json());
    const channelContext = 'channelId' in cmd ? await requireChannel(cmd.channelId) : null;
    const ctx = channelContext ?? (await access());
    const admin = ['owner', 'admin'].includes(ctx.membership.role);
    if (
      [
        'createServer',
        'createChannel',
        'addDestination',
        'deleteDestination',
        'rotateKey',
        'addMember',
        'removeMember',
      ].includes(cmd.action) &&
      !admin
    )
      throw new ApiError(403, 'Administrator access required.');
    if (cmd.action === 'createServer') {
      await db.insert(mediaServer).values({
        id: randomUUID(),
        workspaceId: ctx.workspace.id,
        name: cmd.name,
        host: cmd.host,
        region: cmd.region,
      });
    } else if (cmd.action === 'createChannel') {
      const server = await db.query.mediaServer.findFirst({
        where: and(eq(mediaServer.id, cmd.serverId), eq(mediaServer.workspaceId, ctx.workspace.id)),
      });
      if (!server) throw new ApiError(404, 'Node not found.');
      await db.insert(channel).values({
        id: randomUUID(),
        workspaceId: ctx.workspace.id,
        serverId: server.id,
        name: cmd.name,
        protocol: cmd.protocol,
        ingestKey: randomBytes(24).toString('hex'),
      });
    } else if (cmd.action === 'addMember') {
      if (ctx.membership.role !== 'owner')
        throw new ApiError(403, 'Only owners can manage members.');
      const person = await db.query.user.findFirst({
        where: eq(user.email, cmd.email.toLowerCase()),
      });
      if (!person) throw new ApiError(400, 'Ask this person to create an account first.');
      const existing = await db.query.member.findFirst({ where: eq(member.userId, person.id) });
      if (existing?.workspaceId === ctx.workspace.id)
        throw new ApiError(400, 'This person is already in your workspace.');
      await db
        .insert(invitation)
        .values({
          id: randomUUID(),
          workspaceId: ctx.workspace.id,
          userId: person.id,
          role: cmd.role,
        })
        .onConflictDoNothing();
    } else if (cmd.action === 'acceptInvitation') {
      await db.transaction(async (tx) => {
        const { sql } = await import('drizzle-orm');
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.user.id}))`);
        const invite = await tx.query.invitation.findFirst({
          where: and(eq(invitation.id, cmd.invitationId), eq(invitation.userId, ctx.user.id)),
        });
        if (!invite) throw new ApiError(404, 'Invitation not found.');
        const current = await tx.query.member.findFirst({ where: eq(member.userId, ctx.user.id) });
        if (current?.role === 'owner') {
          const configured = await tx.query.mediaServer.findFirst({
            where: eq(mediaServer.workspaceId, current.workspaceId),
          });
          const teammates = await tx
            .select()
            .from(member)
            .where(eq(member.workspaceId, current.workspaceId));
          if (configured || teammates.length > 1)
            throw new ApiError(
              409,
              'Your current workspace has nodes or teammates. Use a separate account to join another workspace.',
            );
        }
        if (current) await tx.delete(member).where(eq(member.id, current.id));
        await tx.insert(member).values({
          id: randomUUID(),
          workspaceId: invite.workspaceId,
          userId: ctx.user.id,
          role: invite.role,
        });
        await tx.delete(invitation).where(eq(invitation.id, invite.id));
      });
    } else if (cmd.action === 'declineInvitation') {
      await db
        .delete(invitation)
        .where(and(eq(invitation.id, cmd.invitationId), eq(invitation.userId, ctx.user.id)));
    } else if (cmd.action === 'removeMember') {
      if (ctx.membership.role !== 'owner')
        throw new ApiError(403, 'Only owners can manage members.');
      await db
        .delete(member)
        .where(
          and(
            eq(member.id, cmd.memberId),
            eq(member.workspaceId, ctx.workspace.id),
            inArray(member.role, ['admin', 'operator']),
          ),
        );
    } else if (channelContext) {
      const c = channelContext.channel;
      if (cmd.action === 'credentials') {
        const server = await db.query.mediaServer.findFirst({
          where: eq(mediaServer.id, c.serverId),
        });
        return NextResponse.json(
          { host: server!.host, path: `input_${c.id}`, username: c.id, key: c.ingestKey },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      if (cmd.action === 'rotateKey') {
        if (c.desired === 'running')
          throw new ApiError(409, 'End this session before rotating its ingest key.');
        await db
          .update(channel)
          .set({ ingestKey: randomBytes(24).toString('hex') })
          .where(eq(channel.id, c.id));
      }
      if (cmd.action === 'addDestination') {
        if (c.desired === 'running')
          throw new ApiError(409, 'End this session before adding destinations.');
        await db.insert(destination).values({
          id: randomUUID(),
          channelId: c.id,
          name: cmd.name,
          provider: cmd.provider,
          url: cmd.url.replace(/\/$/, ''),
          encryptedKey: encrypt(cmd.key),
        });
      }
      if (cmd.action === 'toggleDestination')
        await db
          .update(destination)
          .set({ enabled: cmd.enabled })
          .where(and(eq(destination.id, cmd.destinationId), eq(destination.channelId, c.id)));
      if (cmd.action === 'deleteDestination') {
        if (c.desired === 'running')
          throw new ApiError(409, 'End this session before removing destinations.');
        await db
          .delete(destination)
          .where(and(eq(destination.id, cmd.destinationId), eq(destination.channelId, c.id)));
      }
      if (cmd.action === 'scene') {
        if (c.desired === 'running')
          throw new ApiError(409, 'End this session before editing its scene.');
        await db
          .update(channel)
          .set({
            sceneTitle: cmd.title,
            sceneSubtitle: cmd.subtitle,
            sceneColor: cmd.color,
            graceSeconds: cmd.graceSeconds,
          })
          .where(eq(channel.id, c.id));
      }
      if (cmd.action === 'fallback')
        await db.update(channel).set({ manualFallback: cmd.enabled }).where(eq(channel.id, c.id));
      if (cmd.action === 'start') {
        const enabled = await db.query.destination.findFirst({
          where: and(eq(destination.channelId, c.id), eq(destination.enabled, true)),
        });
        if (!enabled) throw new ApiError(400, 'Add and enable at least one destination.');
        const server = await db.query.mediaServer.findFirst({
          where: eq(mediaServer.id, c.serverId),
        });
        if (!server?.heartbeatAt || Date.now() - server.heartbeatAt.getTime() > 15000)
          throw new ApiError(
            409,
            'This node is offline. Start its media worker before going live.',
          );
        const updated = await db
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
        if (updated.length)
          await db.insert(event).values({
            id: randomUUID(),
            channelId: c.id,
            sessionId: updated[0].sessionId,
            kind: 'session',
            message: 'Session requested. Starting all enabled destinations.',
          });
      }
      if (cmd.action === 'stop') {
        await db
          .update(channel)
          .set({ desired: 'stopped', state: 'ending', endReason: 'intentional' })
          .where(and(eq(channel.id, c.id), eq(channel.desired, 'running')));
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
