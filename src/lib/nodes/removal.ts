import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { channel, mediaServer, nodeInstallation, nodePreview } from '../db/schema';
/** The FK cascades from channels remove destinations and events. Delete the node
 * last so a failed transaction leaves a retryable removal job, not an orphan. */
export async function deleteNodeData(nodeId: string, workspaceId: string) {
  await db.transaction(async (tx) => {
    const [node] = await tx
      .select({ id: mediaServer.id })
      .from(mediaServer)
      .where(and(eq(mediaServer.id, nodeId), eq(mediaServer.workspaceId, workspaceId)))
      .for('update');
    if (!node) return;
    await tx.delete(channel).where(eq(channel.serverId, nodeId));
    await tx.delete(nodePreview).where(eq(nodePreview.nodeId, nodeId));
    await tx.delete(nodeInstallation).where(eq(nodeInstallation.nodeId, nodeId));
    await tx.delete(mediaServer).where(eq(mediaServer.id, nodeId));
  });
}
export const removalStatuses = ['queued_remove', 'removing', 'remove_failed', 'remote_removed'];
export const busyInstallationStatuses = [
  'queued_check',
  'checking',
  'queued_install',
  'installing',
  'waiting',
];
