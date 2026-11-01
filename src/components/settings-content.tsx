import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { SettingsModal } from './settings-modal';

export async function SettingsContent({ intercepted = false }: { intercepted?: boolean }) {
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const person = await db.query.user.findFirst({ where: eq(user.id, session.user.id) });
  if (!person?.active) redirect('/login?deactivated=1');
  return (
    <SettingsModal user={{ name: person.name, email: person.email }} intercepted={intercepted} />
  );
}
