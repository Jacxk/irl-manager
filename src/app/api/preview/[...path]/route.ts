import { readSettings } from '@/lib/settings';
import { db } from '@/lib/db';
import { mediaServer } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { remotePreview } from '@/lib/nodes/preview';
import { ApiError, requireChannel } from '@/lib/access';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const [channelId, ...segments] = (await params).path;
    if (
      !segments.length ||
      segments.some((p) => !/^[-a-zA-Z0-9_.]+$/.test(p) || p === '.' || p === '..')
    )
      return new Response(null, { status: 400 });
    const ctx = await requireChannel(channelId);
    const statusRequest = segments.length === 1 && segments[0] === 'status.json';
    const source = statusRequest || ctx.channel.desired !== 'running' ? 'input' : 'program';
    const { values: settings } = await readSettings();
    if (source === 'input' && !settings.allowPreLivePreview && ctx.channel.desired !== 'running')
      throw new ApiError(403, 'Input preview is disabled by instance policy.');
    const mediaPath = `${source}_${channelId}/${statusRequest ? 'index.m3u8' : segments.join('/')}`;
    async function status(response: Response) {
      const connected = response.ok && (await response.text()).trimStart().startsWith('#EXTM3U');
      return Response.json({ connected }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const node = await db.query.mediaServer.findFirst({
      where: eq(mediaServer.id, ctx.channel.serverId),
    });
    if (node?.agentTokenHash) {
      if (statusRequest && (!node.heartbeatAt || Date.now() - node.heartbeatAt.getTime() > 15000))
        return Response.json({ connected: false }, { headers: { 'Cache-Control': 'no-store' } });
      const response = await remotePreview(node.id, mediaPath, request.signal);
      return statusRequest ? status(response) : response;
    }
    if (ctx.channel.serverId !== process.env.MEDIA_SERVER_ID)
      return new Response('Preview is not configured for this server.', { status: 503 });
    const url = new URL(`${process.env.MEDIA_HLS_URL ?? 'http://localhost:8888'}/${mediaPath}`);
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Authorization: `Basic ${Buffer.from(`worker:${process.env.MEDIA_WORKER_TOKEN ?? ''}`).toString('base64')}`,
      },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
    });
    if (statusRequest) return await status(response);
    if (!response.ok)
      return new Response('Program not ready.', { status: response.status === 404 ? 404 : 502 });
    // MediaMTX manifests use relative URI references. Strip any server credentials defensively.
    if (segments.at(-1)?.endsWith('.m3u8')) {
      const manifest = (await response.text()).replace(/\?(?:user|pass)=[^\s"\n]+/g, '');
      return new Response(manifest, {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new Response(error.message, { status: error.status });
    return new Response('Preview unavailable.', { status: 503 });
  }
}
