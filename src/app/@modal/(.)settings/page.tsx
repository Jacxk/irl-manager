import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SettingsModal } from '@/components/settings-modal';

export default async function SettingsModalPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return (
    <SettingsModal user={{ name: session.user.name, email: session.user.email }} intercepted />
  );
}
