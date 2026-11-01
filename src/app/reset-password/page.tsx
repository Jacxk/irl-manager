'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useDisplayDefaults } from '@/components/instance-display';
import { authClient } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export default function ResetPassword() {
  const { minPasswordLength } = useDisplayDefaults();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl mb-5">Reset password</h1>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const password = String(new FormData(e.currentTarget).get('password'));
          try {
            const result = await authClient.resetPassword({
              token: window.location.hash.slice(1),
              newPassword: password,
            });
            if (result.error) setMessage(result.error.message ?? 'Reset failed.');
            else {
              window.history.replaceState(null, '', '/reset-password');
              setMessage('Password updated. You can now sign in.');
            }
          } catch {
            setMessage('Unable to reset password.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="password">New password</label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={minPasswordLength}
          maxLength={128}
          autoComplete="new-password"
        />
        <Button disabled={busy}>Update password</Button>
      </form>
      <p role="status" className="my-4">
        {message}
      </p>
      <Link href="/login">Return to sign in</Link>
    </main>
  );
}
