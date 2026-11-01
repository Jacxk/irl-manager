import { readCommandBody } from '@/lib/request-body';
import { ApiError } from '@/lib/access';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { channel } from '@/lib/db/schema';
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function POST(request: Request) {
  try {
    const body = await readCommandBody(request);
    if (
      body.user === 'worker' &&
      process.env.MEDIA_WORKER_TOKEN &&
      equal(String(body.password ?? ''), process.env.MEDIA_WORKER_TOKEN)
    )
      return new Response(null, { status: 200 });
    if (
      body.action !== 'publish' ||
      typeof body.path !== 'string' ||
      !body.path.startsWith('input_')
    )
      return new Response(null, { status: 401 });
    const found = await db.query.channel.findFirst({ where: eq(channel.id, body.path.slice(6)) });
    if (!found || body.user !== found.id || !equal(String(body.password ?? ''), found.ingestKey))
      return new Response(null, { status: 401 });
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError && error.status === 413)
      return new Response(null, { status: 413 });
    return new Response(null, { status: 401 });
  }
}
