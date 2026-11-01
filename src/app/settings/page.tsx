import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Dashboard } from '@/components/dashboard';
import { SettingsModal } from '@/components/settings-modal';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return (
    <>
      <Dashboard />
      <SettingsModal user={{ name: session.user.name, email: session.user.email }} />
    </>
  );
}
