'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ThemeSelect } from '@/components/theme';

export function SettingsModal({
  user,
  intercepted = false,
}: {
  user: { name: string; email: string };
  intercepted?: boolean;
}) {
  const router = useRouter();
  const view = useSearchParams().get('view');
  function close() {
    if (intercepted) router.back();
    else router.replace(view ? `/?${new URLSearchParams({ view })}` : '/');
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-2xl p-0">
        <header className="border-b border-border px-6 py-6 sm:px-8">
          <DialogTitle className="pr-8 text-xl font-medium tracking-tight">Settings</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            Manage your account preferences and make this workspace feel like yours.
          </DialogDescription>
        </header>
        <div className="px-6 sm:px-8">
          <section className="py-6" aria-labelledby="account-heading">
            <h2
              id="account-heading"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Account
            </h2>
            <dl className="mt-3 divide-y divide-border text-sm">
              <div className="grid gap-1.5 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="min-w-0 break-words">{user.name}</dd>
              </div>
              <div className="grid gap-1.5 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
                <dt className="text-muted-foreground">Email address</dt>
                <dd className="min-w-0 break-words">{user.email}</dd>
              </div>
            </dl>
          </section>
          <section className="border-t border-border py-6" aria-labelledby="appearance-heading">
            <h2
              id="appearance-heading"
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Appearance
            </h2>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-sm font-medium">Theme</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Light, dark, or your device setting.
                </p>
              </div>
              <ThemeSelect showLabel={false} />
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
