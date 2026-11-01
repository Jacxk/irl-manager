import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { nodePreview } from '@/lib/db/schema';
import { nodeAuth, apiFailure } from '@/lib/nodes/security';
import { ApiError } from '@/lib/access';
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const node = await nodeAuth(request);
    if (node.agentInstance !== request.headers.get('x-node-instance'))
      throw new ApiError(409, 'Agent lease lost.');
    const { id } = await params;
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'Missing preview body.');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new ApiError(413, 'Preview segment is too large.');
      }
      chunks.push(value);
    }
    const status = Number(request.headers.get('x-preview-status'));
    if (![200, 400, 401, 404, 500, 502, 503].includes(status))
      throw new ApiError(400, 'Invalid preview status.');
    const type = request.headers.get('content-type')?.split(';')[0];
    const contentType = [
      'application/vnd.apple.mpegurl',
      'application/x-mpegURL',
      'video/mp2t',
      'video/MP2T',
      'video/mp4',
      'application/octet-stream',
    ].includes(type ?? '')
      ? type!
      : 'application/octet-stream';
    await db
      .update(nodePreview)
      .set({ status, contentType, body: Buffer.concat(chunks).toString('base64') })
      .where(
        and(
          eq(nodePreview.id, id),
          eq(nodePreview.nodeId, node.id),
          gt(nodePreview.expiresAt, new Date()),
          isNull(nodePreview.status),
        ),
      );
    return new Response(null, { status: 204 });
  } catch (e) {
    return apiFailure(e);
  }
}
