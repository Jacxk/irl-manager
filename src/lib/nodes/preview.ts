import { randomUUID } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { nodePreview } from '../db/schema';
import { ApiError } from '../access';
export async function remotePreview(nodeId: string, path: string) {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`preview:${nodeId}`}))`);
    await tx
      .delete(nodePreview)
      .where(and(eq(nodePreview.nodeId, nodeId), lt(nodePreview.expiresAt, new Date())));
    const active = await tx
      .select({ id: nodePreview.id })
      .from(nodePreview)
      .where(and(eq(nodePreview.nodeId, nodeId), gt(nodePreview.expiresAt, new Date())));
    if (active.length >= 32)
      throw new ApiError(429, 'Too many simultaneous previews for this node.');
    await tx
      .insert(nodePreview)
      .values({ id, nodeId, path, expiresAt: new Date(Date.now() + 20000) });
  });
  try {
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      const result = await db.query.nodePreview.findFirst({ where: eq(nodePreview.id, id) });
      if (result?.status)
        return new Response(Buffer.from(result.body ?? '', 'base64'), {
          status: result.status,
          headers: {
            'Content-Type': result.contentType ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
          },
        });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return new Response('Node preview timed out.', { status: 504 });
  } finally {
    await db.delete(nodePreview).where(eq(nodePreview.id, id));
  }
}
