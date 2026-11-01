import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { mediaServer } from '../db/schema';
import { ApiError, access } from '../access';
export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function nodeAuth(request: Request) {
  const id = request.headers.get('x-node-id');
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!id || !token) throw new ApiError(401, 'Node credentials required.');
  const node = await db.query.mediaServer.findFirst({ where: eq(mediaServer.id, id) });
  if (!node?.agentTokenHash || !safeEqual(node.agentTokenHash, tokenHash(token)))
    throw new ApiError(401, 'Invalid node credentials.');
  if (node.removalRequestedAt) throw new ApiError(410, 'This node is being permanently removed.');
  return node;
}
export async function installerAccess(request?: Request) {
  if (
    request &&
    request.headers.get('origin') !== new URL(process.env.BETTER_AUTH_URL ?? request.url).origin
  )
    throw new ApiError(403, 'Invalid request origin.');
  const ctx = await access();
  if (!['owner', 'admin'].includes(ctx.membership.role))
    throw new ApiError(403, 'Administrator access required.');
  return ctx;
}
export function apiFailure(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error('Node operation failed:', error instanceof Error ? error.name : 'Unknown error');
  return Response.json(
    { error: 'Node operation failed. Check the installation logs and try again.' },
    { status: 500 },
  );
}
export function validControlUrl(value: string, mode: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use the app origin without a path, query, or credentials.');
  const dev = process.env.ALLOW_INSECURE_NODE_CONTROL === '1';
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      (dev ||
        (mode === 'local' &&
          ['localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname)))
    )
  )
    throw new Error('Remote nodes require a public HTTPS application URL.');
  return url.origin;
}

export function localInstallAllowed(email: string) {
  return (
    process.env.ENABLE_LOCAL_INSTALL === '1' &&
    (process.env.LOCAL_INSTALL_ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .includes(email.toLowerCase())
  );
}
