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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          if (intercepted) router.back();
          else router.replace(view ? `/?${new URLSearchParams({ view })}` : '/');
        }
      }}
    >
      <DialogContent>
        <DialogTitle className="pr-6 text-xl font-medium tracking-tight">Settings</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          Your account and preferences.
        </DialogDescription>
        <section className="mt-7" aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-sm font-medium">
            Account
          </h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Name</dt>
              <dd className="mt-1 break-words">{user.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email address</dt>
              <dd className="mt-1 break-words">{user.email}</dd>
            </div>
          </dl>
        </section>
        <section className="mt-6 border-t border-border pt-6" aria-labelledby="appearance-heading">
          <h2 id="appearance-heading" className="text-sm font-medium">
            Appearance
          </h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Choose a theme, or follow your device. Saved in this browser.
          </p>
          <div className="max-w-xs">
            <ThemeSelect />
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
