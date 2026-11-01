'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, LogOut, Settings2, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { ThemeSelect } from './theme';

export function UserMenu({
  user,
}: {
  user: { name: string; email: string; instanceRole?: string };
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const view = useSearchParams().get('view');
  useEffect(() => {
    if (!open) return;
    function outside(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message || 'Unable to sign out.');
      router.push('/login');
      router.refresh();
    } catch {
      setError('Unable to sign out. Please try again.');
      setBusy(false);
    }
  }
  return (
    <div
      ref={root}
      className="relative mt-5 border-t border-border pt-4"
      onBlur={(e) => {
        // A label press can temporarily move focus to the document before its
        // radio activates on release. Only dismiss for an actual outside target;
        // outside pointer presses are handled separately above.
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      {open && (
        <div
          id="user-options"
          aria-label="Account options"
          className="absolute bottom-full left-0 mb-2 w-full rounded-xl border border-border bg-card p-2 shadow-xl"
        >
          {error && (
            <p role="alert" className="p-3 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="mb-1 border-b border-border px-3 py-2">
            <ThemeSelect />
          </div>
          <Link
            href={view ? `/settings?${new URLSearchParams({ view })}` : '/settings'}
            scroll={false}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg p-3 text-xs hover:bg-muted focus-visible:outline-primary"
          >
            <Settings2 size={15} /> Settings
          </Link>
          {user.instanceRole === 'admin' && (
            <Link
              href={`/admin?returnTo=${encodeURIComponent(view ? `/?${new URLSearchParams({ view })}` : '/')}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg p-3 text-xs hover:bg-muted focus-visible:outline-primary"
            >
              <ShieldCheck size={15} /> Instance administration
            </Link>
          )}
          <button
            disabled={busy}
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-lg p-3 text-xs hover:bg-muted disabled:opacity-50"
          >
            <LogOut size={15} /> {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
      <button
        ref={trigger}
        aria-expanded={open}
        aria-controls="user-options"
        aria-label="Open account options"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-lg p-1 text-left hover:bg-muted"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs">
          {user.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs">{user.name}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {user.email}
          </span>
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}
