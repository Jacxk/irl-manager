import { moblinPreviews } from '@/lib/moblin/previews';
import { changeBroadcast } from '@/lib/broadcast';

import { canDeleteChannel } from '@/lib/channel-policy';
import { lockWorkspaceAccess } from '@/lib/workspace-mutation';
import { readCommandBody } from '@/lib/request-body';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
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
import { readSettings } from '@/lib/settings';
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
    const { values: settings } = await readSettings();
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
      .where(
        or(
          eq(mediaServer.workspaceId, ctx.workspace.id),
          and(eq(mediaServer.shared, true), eq(mediaServer.available, true)),
          inArray(
            mediaServer.id,
            channels.map((c) => c.serverId),
          ),
        ),
      );
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
    const protectedPreviews = await moblinPreviews(
      [...new Set(channels.map((c) => c.serverId))],
      settings,
    );
    return NextResponse.json(
      {
        previewOnByDefault: settings.previewOnByDefault,
        allowPreLivePreview: settings.allowPreLivePreview,
        user: ctx.user,
        workspace: ctx.workspace,
        role: ctx.membership.role,
        channels: channels.map((c) => ({
          ...c,
          ingestKey: undefined,
          previewSessionId: protectedPreviews.selected.get(c.id)?.sessionId ?? null,
          previewState: protectedPreviews.selected.get(c.id)?.state ?? 'idle',
          previewQueued: protectedPreviews.queued.has(c.id),
        })),
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
    const { values: settings } = await readSettings();
    if (request.headers.get('origin') !== settings.publicUrl)
      throw new ApiError(403, 'Invalid request origin.');
    const cmd = commandSchema.parse(await readCommandBody(request));
    let channelContext = 'channelId' in cmd ? await requireChannel(cmd.channelId) : null;
    const ctx = channelContext ?? (await access());
    return await db.transaction(async (tx) => {
      let createdId: string | undefined;
      await lockWorkspaceAccess(tx, ctx);
      if (channelContext) {
        const [current] = await tx
          .select()
          .from(channel)
          .where(
            and(
              eq(channel.id, channelContext.channel.id),
              eq(channel.workspaceId, ctx.workspace.id),
            ),
          )
          .for('update');
        if (!current) throw new ApiError(404, 'Channel not found.');
        const node = await tx.query.mediaServer.findFirst({
          where: eq(mediaServer.id, current.serverId),
        });
        if (node?.removalRequestedAt)
          throw new ApiError(409, 'This node is being permanently removed.');
        channelContext = { ...ctx, channel: current };
      }
      const admin = ['owner', 'admin'].includes(ctx.membership.role);
      if (
        [
          'createServer',
          'updateServer',
          'createChannel',
          'deleteChannel',
          'addDestination',
          'updateDestination',
          'deleteDestination',
          'rotateKey',
          'addMember',
          'removeMember',
        ].includes(cmd.action) &&
        !admin
      )
        throw new ApiError(403, 'Administrator access required.');
      if (cmd.action === 'createServer') {
        if (!settings.allowPersonalNodes && ctx.user.instanceRole !== 'admin')
          throw new ApiError(403, 'Personal nodes are disabled.');
        await tx.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.workspace.id}))`);
          const nodes = await tx
            .select({ id: mediaServer.id })
            .from(mediaServer)
            .where(eq(mediaServer.workspaceId, ctx.workspace.id));
          if (settings.maxNodesPerWorkspace && nodes.length >= settings.maxNodesPerWorkspace)
            throw new ApiError(409, 'Workspace node limit reached.');
          await tx.insert(mediaServer).values({
            id: randomUUID(),
            workspaceId: ctx.workspace.id,
            name: cmd.name,
            host: cmd.host,
            region: cmd.region,
          });
        });
      } else if (cmd.action === 'updateServer') {
        const node = await tx.query.mediaServer.findFirst({
          where: and(
            eq(mediaServer.id, cmd.serverId),
            eq(mediaServer.workspaceId, ctx.workspace.id),
          ),
        });
        if (!node) throw new ApiError(404, 'Node not found.');
        if (node.removalRequestedAt) throw new ApiError(409, 'This node is being removed.');
        await tx
          .update(mediaServer)
          .set({ name: cmd.name, host: cmd.host, region: cmd.region })
          .where(eq(mediaServer.id, node.id));
      } else if (cmd.action === 'deleteChannel') {
        const c = channelContext!.channel;
        if (!canDeleteChannel(c))
          throw new ApiError(409, 'Stop the broadcast before deleting this channel.');
        await tx.delete(channel).where(eq(channel.id, c.id));
      } else if (cmd.action === 'createChannel') {
        const server = await tx.query.mediaServer.findFirst({
          where: and(
            eq(mediaServer.id, cmd.serverId),
            or(
              eq(mediaServer.workspaceId, ctx.workspace.id),
              and(eq(mediaServer.shared, true), eq(mediaServer.available, true)),
            ),
          ),
        });
        if (!server) throw new ApiError(404, 'Node not found.');
        if (server.removalRequestedAt) throw new ApiError(409, 'This node is being removed.');
        createdId = randomUUID();
        await tx.insert(channel).values({
          id: createdId,
          workspaceId: ctx.workspace.id,
          serverId: server.id,
          name: cmd.name,
          protocol: cmd.protocol,
          ingestKey: randomBytes(24).toString('hex'),
        });
      } else if (cmd.action === 'addMember') {
        if (ctx.membership.role !== 'owner')
          throw new ApiError(403, 'Only owners can manage members.');
        const person = await tx.query.user.findFirst({
          where: eq(user.email, cmd.email.toLowerCase()),
        });
        if (!person) throw new ApiError(400, 'Ask this person to create an account first.');
        const existing = await tx.query.member.findFirst({ where: eq(member.userId, person.id) });
        if (existing?.workspaceId === ctx.workspace.id)
          throw new ApiError(400, 'This person is already in your workspace.');
        await tx
          .insert(invitation)
          .values({
            id: randomUUID(),
            workspaceId: ctx.workspace.id,
            userId: person.id,
            role: cmd.role,
          })
          .onConflictDoNothing();
      } else if (cmd.action === 'acceptInvitation') {
        await tx.transaction(async (tx) => {
          const { sql } = await import('drizzle-orm');
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.user.id}))`);
          let invite = await tx.query.invitation.findFirst({
            where: and(eq(invitation.id, cmd.invitationId), eq(invitation.userId, ctx.user.id)),
          });
          if (!invite) throw new ApiError(404, 'Invitation not found.');
          // Serialize departures and arrivals across both workspaces in a stable order.
          await tx
            .select({ id: workspace.id })
            .from(workspace)
            .where(inArray(workspace.id, [ctx.workspace.id, invite.workspaceId]))
            .orderBy(workspace.id)
            .for('update');
          invite = await tx.query.invitation.findFirst({
            where: and(eq(invitation.id, cmd.invitationId), eq(invitation.userId, ctx.user.id)),
          });
          if (!invite) throw new ApiError(404, 'Invitation not found.');
          const owner = await tx.query.member.findFirst({
            where: and(eq(member.workspaceId, invite.workspaceId), eq(member.role, 'owner')),
          });
          if (!owner) throw new ApiError(409, 'This invitation no longer has a workspace owner.');

          const current = await tx.query.member.findFirst({
            where: eq(member.userId, ctx.user.id),
          });
          if (current?.role === 'owner') {
            const configured = await tx.query.mediaServer.findFirst({
              where: eq(mediaServer.workspaceId, current.workspaceId),
            });
            const configuredChannel = await tx.query.channel.findFirst({
              where: eq(channel.workspaceId, current.workspaceId),
            });
            const teammates = await tx
              .select()
              .from(member)
              .where(eq(member.workspaceId, current.workspaceId));
            if (configured || configuredChannel || teammates.length > 1)
              throw new ApiError(
                409,
                'Your current workspace has nodes, channels, or teammates. Use a separate account to join another workspace.',
              );
          }
          if (current?.role === 'owner')
            await tx.delete(invitation).where(eq(invitation.workspaceId, current.workspaceId));
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
        await tx
          .delete(invitation)
          .where(and(eq(invitation.id, cmd.invitationId), eq(invitation.userId, ctx.user.id)));
      } else if (cmd.action === 'removeMember') {
        if (ctx.membership.role !== 'owner')
          throw new ApiError(403, 'Only owners can manage members.');
        await tx
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
          const server = await tx.query.mediaServer.findFirst({
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
          await tx
            .update(channel)
            .set({ ingestKey: randomBytes(24).toString('hex') })
            .where(eq(channel.id, c.id));
        }
        if (cmd.action === 'addDestination') {
          if (c.desired === 'running')
            throw new ApiError(409, 'End this session before adding destinations.');
          await tx.insert(destination).values({
            id: randomUUID(),
            channelId: c.id,
            name: cmd.name,
            provider: cmd.provider,
            url: cmd.url.replace(/\/$/, ''),
            encryptedKey: encrypt(cmd.key),
          });
        }
        if (cmd.action === 'updateDestination') {
          if (c.desired === 'running')
            throw new ApiError(409, 'End this session before editing destinations.');
          const patch: { name: string; provider: string; url: string; encryptedKey?: string } = {
            name: cmd.name,
            provider: cmd.provider,
            url: cmd.url.replace(/\/$/, ''),
          };
          if (cmd.key) patch.encryptedKey = encrypt(cmd.key);
          const updated = await tx
            .update(destination)
            .set(patch)
            .where(and(eq(destination.id, cmd.destinationId), eq(destination.channelId, c.id)))
            .returning({ id: destination.id });
          if (!updated.length) throw new ApiError(404, 'Destination not found.');
        }
        if (cmd.action === 'toggleDestination')
          await tx
            .update(destination)
            .set({ enabled: cmd.enabled })
            .where(and(eq(destination.id, cmd.destinationId), eq(destination.channelId, c.id)));
        if (cmd.action === 'deleteDestination') {
          if (c.desired === 'running')
            throw new ApiError(409, 'End this session before removing destinations.');
          await tx
            .delete(destination)
            .where(and(eq(destination.id, cmd.destinationId), eq(destination.channelId, c.id)));
        }
        if (cmd.action === 'scene') {
          if (c.desired === 'running')
            throw new ApiError(409, 'End this session before editing its scene.');
          await tx
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
          await tx.update(channel).set({ manualFallback: cmd.enabled }).where(eq(channel.id, c.id));
        if (cmd.action === 'start' || cmd.action === 'stop')
          await changeBroadcast(tx, c, cmd.action);
      }
      return NextResponse.json(createdId ? { ok: true, channelId: createdId } : { ok: true });
    });
  } catch (error) {
    return fail(error);
  }
}
