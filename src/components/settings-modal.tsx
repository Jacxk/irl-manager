'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDisplayDefaults } from './instance-display';
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
  const { minPasswordLength } = useDisplayDefaults();
  const [savedName, setSavedName] = useState(user.name);
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const passwordDirty = !!(currentPassword || newPassword || confirmation);
  const dirty = name.trim() !== savedName || passwordDirty;
  function reset() {
    setName(savedName);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
    setError('');
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (passwordDirty && newPassword !== confirmation) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (name.trim() !== savedName) {
        const result = await authClient.updateUser({ name: name.trim() });
        if (result.error) throw new Error(result.error.message || 'Unable to update your name.');
        setSavedName(name.trim());
        setName(name.trim());
        router.refresh();
      }
      if (passwordDirty) {
        const result = await authClient.changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        });
        if (result.error)
          throw new Error(result.error.message || 'Unable to change your password.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmation('');
      }
      toast.success('Account settings saved.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  function requestClose() {
    if (busy) return;
    if (dirty) setDiscardOpen(true);
    else close();
  }
  function close() {
    if (intercepted) router.back();
    else router.replace(view ? `/?${new URLSearchParams({ view })}` : '/');
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent className="max-w-2xl p-0">
          <header className="border-b border-border px-6 py-6 sm:px-8">
            <DialogTitle className="pr-8 text-xl font-medium tracking-tight">Settings</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-muted-foreground">
              Manage your account preferences and make this workspace feel like yours.
            </DialogDescription>
          </header>
          <form onSubmit={save}>
            <fieldset disabled={busy} className="min-w-0 px-6 sm:px-8">
              <section className="py-6" aria-labelledby="account-heading">
                <h2
                  id="account-heading"
                  className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Account
                </h2>
                <div className="mt-3 divide-y divide-border text-sm">
                  <div className="grid items-center gap-3 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
                    <Label htmlFor="settings-name">Display name</Label>
                    <Input
                      id="settings-name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={128}
                      pattern=".*\S.*"
                    />
                  </div>
                  <div className="grid items-center gap-3 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
                    <Label htmlFor="settings-email">Email address</Label>
                    <Input id="settings-email" type="email" value={user.email} disabled />
                  </div>
                </div>
              </section>
              <section className="border-t border-border py-6" aria-labelledby="security-heading">
                <h2
                  id="security-heading"
                  className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Password
                </h2>
                <p
                  id="password-help"
                  className="mt-2 text-xs leading-relaxed text-muted-foreground"
                >
                  Use at least {minPasswordLength} characters. Changing your password signs out your
                  other sessions.
                </p>
                <div className="mt-4 space-y-4">
                  <div className="grid items-center gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
                    <Label htmlFor="settings-current-password">Current password</Label>
                    <Input
                      id="settings-current-password"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required={passwordDirty}
                      maxLength={128}
                    />
                  </div>
                  <div className="grid items-center gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
                    <Label htmlFor="settings-new-password">New password</Label>
                    <Input
                      id="settings-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required={passwordDirty}
                      minLength={minPasswordLength}
                      maxLength={128}
                      aria-describedby="password-help"
                    />
                  </div>
                  <div className="grid items-center gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
                    <Label htmlFor="settings-confirm-password">Confirm password</Label>
                    <Input
                      id="settings-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      required={passwordDirty}
                      minLength={minPasswordLength}
                      maxLength={128}
                    />
                  </div>
                </div>
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
              {error && (
                <p role="alert" className="pb-6 text-sm text-destructive">
                  {error}
                </p>
              )}
            </fieldset>
            {dirty && (
              <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-4 shadow-lg sm:px-8">
                <p role="status" className="text-xs text-muted-foreground">
                  Unsaved changes
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={reset}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={busy}>
                    {busy ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogTitle className="text-lg font-medium">Discard unsaved changes?</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            Your account changes have not been saved.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDiscardOpen(false);
                reset();
                close();
              }}
            >
              Discard changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
