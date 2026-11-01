import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth';
import { Dashboard } from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const { db } = await import('@/lib/db');
  const { user } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const person = await db.query.user.findFirst({ where: eq(user.id, session.user.id) });
  if (!person?.active) redirect('/login?deactivated=1');
  return <Dashboard />;
}
