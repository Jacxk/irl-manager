import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  adminAudit,
  instanceSetting,
  mediaServer,
  session,
  user,
  verification,
} from '@/lib/db/schema';
import { instanceAccess, ApiError } from '@/lib/access';
import { readSettings } from '@/lib/settings';
import { settingDefinitions, resolveSetting, type SettingKey } from '@/lib/settings-registry';
export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
function fail(e: unknown) {
  if (e instanceof ApiError) return response({ error: e.message }, e.status);
  if (e instanceof z.ZodError) return response({ error: e.issues[0].message }, 400);
  console.error('Admin operation failed:', e instanceof Error ? e.name : 'Unknown');
  return response(
    { error: 'Administration failed. Check configuration and service availability.' },
    500,
  );
}
export async function GET() {
  try {
    const actor = await instanceAccess();
    const settings = await readSettings();
    const users = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        instanceRole: user.instanceRole,
        active: user.active,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(user.createdAt);
    const audit = await db.select().from(adminAudit).orderBy(desc(adminAudit.createdAt)).limit(100);
    const sharedNodes = await db.select().from(mediaServer).where(eq(mediaServer.shared, true));
    return response({
      fields: settings.fields,
      users,
      audit,
      sharedNodes,
      actorId: actor.id,
      health: { database: 'Connected', application: 'Running' },
      deployment: [
        'DATABASE_URL',
        'ENCRYPTION_KEY',
        'BETTER_AUTH_SECRET',
        'MEDIA_WORKER_TOKEN',
        'LOCK_BY_ENVIRONMENT',
      ].map((name) => ({ name, configured: process.env[name] !== undefined })),
    });
  } catch (e) {
    return fail(e);
  }
}
const command = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('settings'),
    changes: z
      .array(
        z.object({
          key: z.string(),
          value: z.unknown().optional(),
          revision: z.number().int().min(0),
          reset: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(50),
  }),
  z.object({
    action: z.enum(['role', 'status', 'revoke', 'resetPassword']),
    userId: z.string(),
    role: z.enum(['admin', 'user']).optional(),
    active: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('sharedNode'),
    nodeId: z.string().uuid(),
    shared: z.boolean(),
    available: z.boolean(),
  }),
]);
export async function POST(request: Request) {
  let attempt: { actorId: string; target: string; action: string } | undefined;
  try {
    const actor = await instanceAccess();
    const { values } = await readSettings();
    if (request.headers.get('origin') !== values.publicUrl)
      throw new ApiError(403, 'Invalid request origin.');
    const cmd = command.parse(await request.json());
    attempt = {
      actorId: actor.id,
      action: cmd.action,
      target:
        'userId' in cmd
          ? cmd.userId
          : cmd.action === 'sharedNode'
            ? cmd.nodeId
            : cmd.changes.map((c) => c.key).join(','),
    };
    let resetLink: string | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(839152001)`);
      const current = await tx.query.user.findFirst({ where: eq(user.id, actor.id) });
      if (!current?.active || current.instanceRole !== 'admin')
        throw new ApiError(403, 'Administrator access required.');
      let target: string;
      if (cmd.action === 'settings') {
        for (const c of cmd.changes) {
          if (!Object.hasOwn(settingDefinitions, c.key))
            throw new ApiError(400, 'Unknown setting.');
          const key = c.key as SettingKey;
          const existing = await tx.query.instanceSetting.findFirst({
            where: eq(instanceSetting.key, key),
          });
          if (resolveSetting(key, existing?.value ?? undefined).locked)
            throw new ApiError(409, `${key} is locked by environment.`);
          if ((existing?.revision ?? 0) !== c.revision)
            throw new ApiError(409, 'Settings changed. Reload before saving.');
          // Keep tombstones for reset revisions to prevent stale writes after reset.
          const value = c.reset ? null : settingDefinitions[key].schema.parse(c.value);
          await tx
            .insert(instanceSetting)
            .values({ key, value, revision: c.revision + 1 })
            .onConflictDoUpdate({
              target: instanceSetting.key,
              set: { value, revision: c.revision + 1, updatedAt: new Date() },
            });
          await tx
            .insert(adminAudit)
            .values({
              id: randomUUID(),
              actorId: actor.id,
              target: key,
              action: c.reset ? 'setting.reset' : 'setting.update',
            });
        }
        return;
      } else if (cmd.action === 'sharedNode') {
        const node = await tx.query.mediaServer.findFirst({
          where: eq(mediaServer.id, cmd.nodeId),
        });
        const membership = await tx.query.member.findFirst({
          where: eq((await import('@/lib/db/schema')).member.userId, actor.id),
        });
        if (!node || (!node.shared && node.workspaceId !== membership?.workspaceId))
          throw new ApiError(404, 'Register a node in your workspace before sharing it.');
        await tx
          .update(mediaServer)
          .set({ shared: cmd.shared, available: cmd.available })
          .where(eq(mediaServer.id, node.id));
        target = node.id;
      } else {
        const person = await tx.query.user.findFirst({ where: eq(user.id, cmd.userId) });
        if (!person) throw new ApiError(404, 'User not found.');
        if (
          (cmd.action === 'status' && cmd.active === undefined) ||
          (cmd.action === 'role' && !cmd.role)
        )
          throw new ApiError(400, 'Missing value.');
        if (person.id === actor.id && cmd.action === 'status' && !cmd.active)
          throw new ApiError(400, 'You cannot deactivate yourself.');
        if (
          person.active &&
          person.instanceRole === 'admin' &&
          ((cmd.action === 'role' && cmd.role === 'user') ||
            (cmd.action === 'status' && !cmd.active))
        ) {
          const admins = await tx
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.active, true), eq(user.instanceRole, 'admin')));
          if (admins.length < 2)
            throw new ApiError(409, 'The last active administrator must be preserved.');
        }
        if (cmd.action === 'role')
          await tx
            .update(user)
            .set({ instanceRole: cmd.role, updatedAt: new Date() })
            .where(eq(user.id, person.id));
        if (cmd.action === 'status')
          await tx
            .update(user)
            .set({ active: cmd.active, updatedAt: new Date() })
            .where(eq(user.id, person.id));
        if (['role', 'status', 'revoke'].includes(cmd.action))
          await tx.delete(session).where(eq(session.userId, person.id));
        if (cmd.action === 'resetPassword') {
          if (!person.active)
            throw new ApiError(400, 'Reactivate this account before resetting its password.');
          const token = randomBytes(32).toString('hex');
          // Better Auth consumes this verification atomically on reset.
          await tx
            .delete(verification)
            .where(
              and(
                eq(verification.value, person.id),
                like(verification.identifier, 'reset-password:%'),
              ),
            );
          await tx
            .insert(verification)
            .values({
              id: randomUUID(),
              identifier: `reset-password:${token}`,
              value: person.id,
              expiresAt: new Date(Date.now() + 30 * 60_000),
            });
          resetLink = `${values.publicUrl}/reset-password#${token}`;
        }
        target = person.id;
      }
      await tx
        .insert(adminAudit)
        .values({ id: randomUUID(), actorId: actor.id, target, action: cmd.action });
    });
    return response({ ok: true, resetLink });
  } catch (e) {
    if (attempt) {
      try {
        await db
          .insert(adminAudit)
          .values({ id: randomUUID(), ...attempt, action: `${attempt.action}.failed` });
      } catch {
        /* Preserve the original failure when the database is unavailable. */
      }
    }
    return fail(e);
  }
}
