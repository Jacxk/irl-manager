import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/lib/auth';
import { ThemeSelect } from '@/components/theme';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 md:py-16">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} /> Back to workspace
      </Link>
      <h1 className="text-3xl font-medium tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your account and preferences.</p>
      <section className="surface mt-8 p-6" aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-base font-medium">
          Account
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">Your current account details.</p>
        <dl className="mt-6 space-y-5">
          <div>
            <dt className="label">Name</dt>
            <dd className="mt-2 break-words">{session.user.name}</dd>
          </div>
          <div>
            <dt className="label">Email address</dt>
            <dd className="mt-2 break-all">{session.user.email}</dd>
          </div>
        </dl>
      </section>
      <section className="surface mt-5 p-6" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className="text-base font-medium">
          Appearance
        </h2>
        <p className="mb-6 mt-1 text-xs text-muted-foreground">
          Choose a theme, or follow your device. Saved in this browser.
        </p>
        <div className="max-w-xs">
          <ThemeSelect />
        </div>
      </section>
    </main>
  );
}
