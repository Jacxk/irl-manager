'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useDisplayDefaults } from '@/components/instance-display';
import { authClient } from '@/lib/auth-client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export default function ResetPassword() {
  const { minPasswordLength } = useDisplayDefaults();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl mb-5">Reset password</h1>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || complete) return;
          const form = e.currentTarget;
          setBusy(true);
          const password = String(new FormData(form).get('password'));
          try {
            const result = await authClient.resetPassword({
              token: window.location.hash.slice(1),
              newPassword: password,
            });
            if (result.error) setMessage(result.error.message ?? 'Reset failed.');
            else {
              window.history.replaceState(null, '', '/reset-password');
              form.reset();
              setComplete(true);
              setMessage('Password updated. You can now sign in.');
            }
          } catch {
            setMessage('Unable to reset password.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          disabled={busy || complete}
          minLength={minPasswordLength}
          maxLength={128}
          autoComplete="new-password"
        />
        <Button disabled={busy || complete}>Update password</Button>
      </form>
      <p role="status" className="my-4">
        {message}
      </p>
      <Link href="/login">Return to sign in</Link>
    </main>
  );
}
