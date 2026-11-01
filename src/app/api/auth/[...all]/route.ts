import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  const auth = await getAuth();
  const path = new URL(request.url).pathname;
  const publicFlow = ['/sign-in/', '/sign-up/', '/sign-out', '/reset-password'].some((p) =>
    path.includes(p),
  );
  if (!publicFlow) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) {
      const person = await db.query.user.findFirst({ where: eq(user.id, session.user.id) });
      if (!person?.active)
        return Response.json(
          { error: 'This account is deactivated.' },
          { status: 403, headers: { 'Cache-Control': 'no-store' } },
        );
    }
  }
  return auth.handler(request);
}
export const GET = handle;
export const POST = handle;
