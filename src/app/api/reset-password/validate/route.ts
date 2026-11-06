import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { verification } from '@/lib/db/schema';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return Response.json({ valid: false }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const [record] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(
      and(
        eq(verification.identifier, `reset-password:${token}`),
        gt(verification.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Response.json({ valid: Boolean(record) }, { headers: { 'Cache-Control': 'no-store' } });
}
