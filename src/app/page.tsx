import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { Dashboard } from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return <Dashboard />;
}
