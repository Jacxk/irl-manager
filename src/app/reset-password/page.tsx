'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Link2Off, LockKeyhole, Radio, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useDisplayDefaults } from '@/components/instance-display';
import { authClient } from '@/lib/auth-client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function ResetPassword() {
  const { minPasswordLength, instanceName } = useDisplayDefaults();
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkState, setLinkState] = useState<'checking' | 'valid' | 'invalid' | 'error'>(
    'checking',
  );

  useEffect(() => {
    const controller = new AbortController();
    async function checkLink() {
      try {
        const response = await fetch('/api/reset-password/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: window.location.hash.slice(1) }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to check link');
        const data = await response.json();
        setLinkState(data.valid ? 'valid' : 'invalid');
      } catch {
        if (!controller.signal.aborted) setLinkState('error');
      }
    }
    void checkLink();
    return () => controller.abort();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    const confirmation = String(form.get('confirmation'));
    setError('');
    if (password !== confirmation) {
      setError('Passwords do not match. Please try again.');
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.resetPassword({
        token: window.location.hash.slice(1),
        newPassword: password,
      });
      if (result.error) {
        if (result.error.code === 'INVALID_TOKEN') setLinkState('invalid');
        else setError(result.error.message ?? 'Unable to reset password.');
      } else {
        window.history.replaceState(null, '', '/reset-password');
        toast.success('Password updated. You can now sign in.');
        router.replace('/login');
      }
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-2">
      <div className="relative hidden overflow-hidden border-r border-border p-14 lg:flex lg:flex-col lg:justify-between dot-grid">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Radio size={22} />
          </span>
          {instanceName}
        </div>
        <div>
          <div className="mb-7 flex items-center gap-2 font-mono text-xs text-primary">
            <span className="size-2 rounded-full bg-primary" /> ACCOUNT SECURITY
          </div>
          <h1 className="max-w-xl text-6xl leading-[1.08] tracking-tight">
            Back to your <span className="text-primary">control room.</span>
          </h1>
          <p className="mt-7 max-w-sm text-base leading-relaxed text-muted-foreground">
            Choose a new password to get back to managing your stream.
          </p>
          <div className="mt-12 flex items-center gap-3 text-sm">
            <ShieldCheck size={18} className="text-primary" /> Keep your account secure
          </div>
        </div>
        <p className="text-xs text-muted-foreground">YOUR STREAM. YOUR INFRASTRUCTURE.</p>
      </div>
      <main className="flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-sm fade-in">
          <div className="mb-12 flex items-center gap-2 text-primary lg:hidden">
            <Radio /> {instanceName}
          </div>
          <div className="mb-6 grid size-12 place-items-center rounded-xl border border-border bg-card text-primary">
            {linkState === 'invalid' ? <Link2Off size={22} /> : <LockKeyhole size={22} />}
          </div>
          <span className="label">Account security</span>
          {linkState === 'checking' ? (
            <p className="mt-3 text-muted-foreground" role="status">
              Checking your reset link…
            </p>
          ) : linkState === 'invalid' ? (
            <div role="alert">
              <h2 className="mt-3 text-3xl font-medium tracking-tight">This link has expired.</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                This reset link has expired, has already been used, or is invalid. Ask your instance
                administrator for a new link.
              </p>
            </div>
          ) : linkState === 'error' ? (
            <div role="alert">
              <h2 className="mt-3 text-3xl font-medium tracking-tight">
                Unable to check your link.
              </h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Please reload the page and try again.
              </p>
            </div>
          ) : (
            <>
              <h2 className="mt-3 text-3xl font-medium tracking-tight">Reset your password.</h2>
              <p className="mt-3 leading-relaxed text-muted-foreground">
                Enter a new password below. It must be at least {minPasswordLength} characters long.
              </p>
              <form method="post" onSubmit={submit} className="mt-8 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    required
                    disabled={busy}
                    minLength={minPasswordLength}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="Enter a new password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmation">Confirm new password</Label>
                  <Input
                    id="confirmation"
                    name="confirmation"
                    type="password"
                    required
                    disabled={busy}
                    minLength={minPasswordLength}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder="Enter your password again"
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button className="w-full" disabled={busy}>
                  {busy ? 'Updating password…' : 'Update password'} <ArrowRight size={16} />
                </Button>
              </form>
            </>
          )}
          <Link
            href="/login"
            className="mt-7 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeft size={16} /> Back to sign in
          </Link>
        </div>
      </main>
    </div>
  );
}
