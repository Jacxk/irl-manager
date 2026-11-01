import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { member, user } from './db/schema';
import { access, ApiError } from './access';
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Hold authorization until the mutation commits, including membership transfers/removal. */
export async function lockWorkspaceAccess(
  tx: Transaction,
  ctx: Awaited<ReturnType<typeof access>>,
) {
  const [current] = await tx
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.id, ctx.membership.id),
        eq(member.userId, ctx.user.id),
        eq(member.workspaceId, ctx.workspace.id),
        eq(member.role, ctx.membership.role),
      ),
    )
    .for('update');
  if (!current) throw new ApiError(409, 'Workspace access changed. Refresh and try again.');
  // SHARE conflicts with status/role updates while allowing concurrent authorized reads.
  const [person] = await tx
    .select({ active: user.active, instanceRole: user.instanceRole })
    .from(user)
    .where(eq(user.id, ctx.user.id))
    .for('share');
  if (!person?.active) throw new ApiError(403, 'This account is deactivated.');
  if (person.instanceRole !== ctx.user.instanceRole)
    throw new ApiError(409, 'Account permissions changed. Refresh and try again.');
}
