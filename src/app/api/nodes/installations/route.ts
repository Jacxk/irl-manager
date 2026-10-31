import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { mediaServer, nodeInstallation, serviceHeartbeat } from '@/lib/db/schema';
import { encrypt } from '@/lib/crypto';
import { ApiError } from '@/lib/access';
import { installerAccess, apiFailure, tokenHash, localInstallAllowed } from '@/lib/nodes/security';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const ctx = await installerAccess();
    const jobs = await db
      .select()
      .from(nodeInstallation)
      .where(eq(nodeInstallation.workspaceId, ctx.workspace.id));
    const heartbeat = await db.query.serviceHeartbeat.findFirst({
      where: eq(serviceHeartbeat.id, 'installer'),
    });
    const local = await db.query.mediaServer.findFirst({
      where: or(
        eq(mediaServer.localSlot, 'local'),
        ...(heartbeat?.machineId ? [eq(mediaServer.machineId, heartbeat.machineId)] : []),
      ),
    });
    return Response.json(
      {
        installerOnline: !!heartbeat && Date.now() - heartbeat.at.getTime() < 15000,
        jobs: jobs.map(({ encryptedCredentials, ...job }) => ({
          ...job,
          hasCredentials: !!encryptedCredentials,
        })),
        localInstalled: !!local,
        localNodeId: local?.workspaceId === ctx.workspace.id ? local.id : null,
        defaultControlUrl:
          process.env.NODE_CONTROL_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
        localEnabled: localInstallAllowed(ctx.user.email),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return apiFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await installerAccess(request);
    const { mode } = await request.json();
    if (!['local', 'ssh'].includes(mode))
      throw new ApiError(400, 'Choose local installation or SSH.');
    if (mode === 'local' && !localInstallAllowed(ctx.user.email))
      throw new ApiError(
        409,
        'Local installation is disabled. Set ENABLE_LOCAL_INSTALL=1 and add your account email to LOCAL_INSTALL_ADMIN_EMAILS on the app server.',
      );
    const id = randomUUID(),
      nodeId = randomUUID(),
      token = randomBytes(32).toString('hex');
    await db.transaction(async (tx) => {
      if (
        mode === 'local' &&
        (await tx.query.mediaServer.findFirst({
          where: or(
            eq(mediaServer.localSlot, 'local'),
            ...((
              await tx.query.serviceHeartbeat.findFirst({
                where: eq(serviceHeartbeat.id, 'installer'),
              })
            )?.machineId
              ? [
                  eq(
                    mediaServer.machineId,
                    (await tx.query.serviceHeartbeat.findFirst({
                      where: eq(serviceHeartbeat.id, 'installer'),
                    }))!.machineId!,
                  ),
                ]
              : []),
          ),
        }))
      )
        throw new ApiError(
          409,
          'This server already has a local node. Resume its setup from the Nodes page.',
        );
      await tx.insert(mediaServer).values({
        id: nodeId,
        workspaceId: ctx.workspace.id,
        name: mode === 'local' ? 'Local node' : 'New remote node',
        host: mode === 'local' ? 'localhost' : 'unconfigured',
        region: mode === 'local' ? 'Local' : 'Remote',
        agentTokenHash: tokenHash(token),
        encryptedAgentToken: encrypt(token),
        localSlot: mode === 'local' ? 'local' : null,
      });
      await tx.insert(nodeInstallation).values({
        id,
        nodeId,
        workspaceId: ctx.workspace.id,
        mode,
        config: {
          name: mode === 'local' ? 'Local node' : 'Remote node',
          host: mode === 'local' ? 'localhost' : '',
          region: mode === 'local' ? 'Local' : 'Remote',
          controlUrl:
            process.env.NODE_CONTROL_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
          sshHost: '',
          sshPort: 22,
          sshUser: 'root',
          sshAuth: 'key',
        },
      });
    });
    const job = await db.query.nodeInstallation.findFirst({
      where: and(eq(nodeInstallation.id, id), eq(nodeInstallation.workspaceId, ctx.workspace.id)),
    });
    return Response.json({ ...job, encryptedCredentials: undefined, hasCredentials: false });
  } catch (e) {
    if (
      (e as { code?: string; cause?: { code?: string } }).code === '23505' ||
      (e as { cause?: { code?: string } }).cause?.code === '23505'
    )
      return Response.json({ error: 'This host already has a local node.' }, { status: 409 });
    return apiFailure(e);
  }
}
