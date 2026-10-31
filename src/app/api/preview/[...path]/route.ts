import { ApiError, requireChannel } from '@/lib/access';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const [channelId, ...segments] = (await params).path;
    if (
      !segments.length ||
      segments.some((p) => !/^[-a-zA-Z0-9_.]+$/.test(p) || p === '.' || p === '..')
    )
      return new Response(null, { status: 400 });
    const ctx = await requireChannel(channelId);
    if (ctx.channel.serverId !== process.env.MEDIA_SERVER_ID)
      return new Response('Preview is not configured for this server.', { status: 503 });
    const url = new URL(
      `${process.env.MEDIA_HLS_URL ?? 'http://localhost:8888'}/program_${channelId}/${segments.join('/')}`,
    );
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Authorization: `Basic ${Buffer.from(`worker:${process.env.MEDIA_WORKER_TOKEN ?? ''}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(10000),
    });
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
