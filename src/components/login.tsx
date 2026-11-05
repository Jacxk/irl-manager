'use client';
import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Radio, ShieldCheck, Waypoints, Wifi } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export function Login({
  registrationEnabled,
  minPasswordLength,
  instanceName,
  loginMessage,
  logoUrl,
}: {
  registrationEnabled: boolean;
  minPasswordLength: number;
  instanceName: string;
  loginMessage: string;
  logoUrl: string;
}) {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const data = {
        email: String(form.get('email')),
        password: String(form.get('password')),
        name: String(form.get('name') || ''),
      };
      const result = signup
        ? await authClient.signUp.email(data)
        : await authClient.signIn.email(data);
      if (result.error) setError(result.error.message ?? 'Unable to sign in.');
      else {
        router.push('/');
        router.refresh();
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
          </span>{' '}
          {instanceName}
        </div>
        <div className="relative">
          <div className="mb-7 flex items-center gap-2 text-primary font-mono text-xs">
            <span className="size-2 rounded-full bg-primary" /> BUILT FOR LIFE OUT THERE
          </div>
          <h1 className="max-w-xl text-6xl leading-[1.08] tracking-tight">
            Go anywhere.
            <br />
            Stay live.
            <br />
            <span className="text-primary">Reach everyone.</span>
          </h1>
          <p className="mt-7 max-w-sm text-base leading-relaxed text-muted-foreground">
            One control room for your IRL stream. Every connection, every destination, every moment.
          </p>
          <div className="mt-12 flex flex-col gap-5 text-sm">
            <span className="flex items-center gap-3">
              <Waypoints size={18} className="text-primary" /> Stream to multiple platforms at once
            </span>
            <span className="flex items-center gap-3">
              <Wifi size={18} className="text-primary" /> SRTLA, SRT, and RTMP ingest
            </span>
            <span className="flex items-center gap-3">
              <ShieldCheck size={18} className="text-primary" /> Keep your audience through
              connection drops
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">YOUR STREAM. YOUR INFRASTRUCTURE.</p>
      </div>
      <main className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm fade-in">
          <div className="mb-12 flex items-center gap-2 text-primary lg:hidden">
            <Radio /> {instanceName}
          </div>
          <span className="label">{instanceName}</span>
          {logoUrl && (
            <Image
              unoptimized
              width={192}
              height={64}
              src={logoUrl}
              alt="Instance logo"
              className="my-4 max-h-16 max-w-48"
            />
          )}
          {loginMessage && <p className="my-4">{loginMessage}</p>}
          <h2 className="mt-3 text-3xl tracking-tight font-medium">
            {signup ? 'Make yourself at home.' : 'Welcome back.'}
          </h2>
          <p className="mt-3 text-muted-foreground">
            {signup
              ? 'Create an account to set up your workspace.'
              : 'Sign in and take your stream out into the world.'}
          </p>
          <form method="post" onSubmit={submit} className="mt-8 space-y-5">
            {signup && (
              <label className="block space-y-2">
                <span className="text-sm">Your name</span>
                <Input
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Alex Rivers"
                  maxLength={80}
                />
              </label>
            )}
            <label className="block space-y-2">
              <span>Email</span>
              <Input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label className="block space-y-2">
              <span>Password</span>
              <Input
                name="password"
                type="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? minPasswordLength : 1}
                required
                placeholder={signup ? 'Your new password' : 'Your password'}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button className="w-full" disabled={busy}>
              {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
              <ArrowUpRight size={16} />
            </Button>
          </form>
          {registrationEnabled && (
            <p className="mt-7 text-sm text-muted-foreground">
              {signup ? 'Already have an account?' : 'New here?'}{' '}
              <button
                className="ml-1 text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setSignup(!signup);
                  setError('');
                }}
              >
                {signup ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
