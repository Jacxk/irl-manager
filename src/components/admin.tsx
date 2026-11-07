'use client';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  ArrowLeft,
  Globe,
  KeyRound,
  LockKeyhole,
  Menu,
  Megaphone,
  Palette,
  Radio,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useDisplayDefaults } from './instance-display';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
type Field = {
  key: string;
  label: string;
  section: string;
  env: string;
  value: string | number | boolean;
  default: string | number | boolean;
  locked: boolean;
  source: string;
  revision: number;
};
type Person = { id: string; name: string; email: string; instanceRole: string; active: boolean };
type Data = {
  fields: Field[];
  users: Person[];
  actorId: string;
  audit: { id: string; actorId: string; target: string; action: string; createdAt: string }[];
  sharedNodes: { id: string; name: string; host: string; available: boolean }[];
  health: Record<string, string>;
  deployment: { name: string; configured: boolean }[];
};
const sections: { name: string; icon: LucideIcon; description: string }[] = [
  {
    name: 'General',
    icon: Settings2,
    description: 'The identity and public address of your instance.',
  },
  { name: 'Appearance', icon: Palette, description: 'Make the control room your own.' },
  {
    name: 'Announcements',
    icon: Megaphone,
    description: 'Messages for everyone using this instance.',
  },
  {
    name: 'Access',
    icon: KeyRound,
    description: 'Registration, authentication, and session policies.',
  },
  {
    name: 'Policies',
    icon: SlidersHorizontal,
    description: 'Set the boundaries for workspace resources.',
  },
  {
    name: 'UI defaults',
    icon: Globe,
    description: 'Default locale and time formatting for your instance.',
  },
  {
    name: 'Node operations',
    icon: Server,
    description:
      'Control new local and SSH installations and permanent removal. Remote nodes require HTTPS unless the deployment explicitly permits insecure development control.',
  },
  {
    name: 'Moblin',
    icon: Radio,
    description:
      'Optional phone pairing and low bitrate BRB defaults. Production requires a WSS reverse proxy to the Moblin gateway on port 3001. Do not expose passwords or change TLS requirements here.',
  },
  { name: 'Users', icon: Users, description: 'Manage accounts, access, and password recovery.' },
  {
    name: 'Shared nodes',
    icon: Server,
    description: 'Optional media infrastructure available to all workspaces.',
  },
  {
    name: 'Administration',
    icon: ShieldCheck,
    description: 'Service health, deployment configuration, and change history.',
  },
];
export function Admin({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const requestedReturn = params.get('returnTo') ?? '/';
  const returnTo = /^\/(?:\?view=(?:overview|channels|destinations|scenes|nodes|team))?$/.test(
    requestedReturn,
  )
    ? requestedReturn
    : '/';
  const display = useDisplayDefaults();
  const [data, setData] = useState<Data>();
  const pathname = usePathname();
  const sectionHref = (name: string) =>
    name === 'General' ? '/admin' : `/admin/${name.toLowerCase().replaceAll(' ', '-')}`;
  const section = sections.find((s) => sectionHref(s.name) === pathname)?.name;
  const [mobile, setMobile] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [resets, setResets] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [resetLink, setResetLink] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    action: () => void;
  }>();
  const changes =
    data?.fields.filter(
      (f) =>
        !f.locked &&
        (resets.includes(f.key) || (Object.hasOwn(draft, f.key) && draft[f.key] !== f.value)),
    ) ?? [];
  const dirty = changes.length > 0;
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin', { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        if (!cancelled) setData(body);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setResetLink('');
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      if (body.userId === data?.actorId && ['role', 'revoke'].includes(String(body.action))) {
        router.replace('/login');
        return;
      }
      const refreshed = await fetch('/api/admin', { cache: 'no-store' });
      const fresh = await refreshed.json();
      if (!refreshed.ok) throw new Error(fresh.error);
      setData(fresh);
      if (body.action === 'settings') {
        setDraft({});
        setResets([]);
      }
      if (result.resetLink) setResetLink(result.resetLink);
      toast.success(body.action === 'settings' ? 'Settings saved.' : 'Changes saved.', {
        id: 'admin-operation',
      });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed.', { id: 'admin-operation' });
    } finally {
      setBusy(false);
    }
  }
  function save() {
    if (!dirty || busy) return;
    run({
      action: 'settings',
      changes: changes.map((f) => ({
        key: f.key,
        value: draft[f.key],
        reset: resets.includes(f.key),
        revision: f.revision,
      })),
    });
  }
  function goBack() {
    if (dirty)
      setConfirmation({
        title: 'Discard unsaved changes?',
        description:
          'Your settings have not been saved. Leave administration and return to your workspace?',
        action: () => router.push(returnTo),
      });
    else router.push(returnTo);
  }
  function confirmAction(title: string, description: string, body: Record<string, unknown>) {
    setConfirmation({
      title,
      description,
      action: () => {
        void run(body);
      },
    });
  }
  const current = sections.find((s) => s.name === section);
  if (!current) return <>{children}</>;
  return (
    <div className="min-h-dvh lg:pl-[232px]">
      {mobile && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        aria-label="Administration sidebar"
        className={cn(
          'fixed bottom-0 left-0 top-[var(--development-banner-height)] z-40 flex w-[232px] flex-col border-r border-border bg-card transition-transform lg:translate-x-0',
          mobile ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button
          onClick={goBack}
          disabled={busy}
          className="flex h-[84px] shrink-0 items-center gap-2.5 px-6 text-lg font-semibold tracking-tight text-left"
        >
          {display.logoUrl ? (
            <Image unoptimized src={display.logoUrl} alt="" width={32} height={32} />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Radio size={20} />
            </span>
          )}
          <span className="truncate">{display.instanceName}</span>
        </button>
        <div className="flex items-center justify-between px-6 mb-4">
          <span className="label">INSTANCE</span>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={16} />
          </Button>
        </div>
        <nav aria-label="Admin sections" className="min-h-0 flex-1 overflow-y-auto px-3 space-y-1">
          {sections.map((s) => (
            <Button
              key={s.name}
              asChild
              variant="ghost"
              aria-current={section === s.name ? 'page' : undefined}
              className={cn(
                'w-full justify-start gap-3 px-3 text-[13px] font-normal',
                section === s.name &&
                  'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
              )}
            >
              <Link
                href={`${sectionHref(s.name)}${returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`}
                onClick={() => setMobile(false)}
              >
                <s.icon size={17} />
                {s.name}
                {data && data.fields.some((f) => f.section === s.name && changes.includes(f)) && (
                  <span
                    className="ml-auto size-1.5 rounded-full bg-primary"
                    aria-label="Unsaved changes"
                  />
                )}
              </Link>
            </Button>
          ))}
        </nav>
        <div className="p-4 mt-auto">
          <div className="border-t border-border pt-4">
            <Button
              variant="ghost"
              disabled={busy}
              className="w-full justify-start gap-3"
              onClick={goBack}
            >
              <ArrowLeft size={17} />
              Back to workspace
            </Button>
          </div>
        </div>
      </aside>
      <header className="flex h-[70px] items-center gap-3 border-b border-border px-5 md:px-9">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={() => setMobile(true)}
        >
          <Menu size={20} />
        </Button>
        <span className="text-xs text-muted-foreground">Administration</span>
        <span className="text-border">/</span>
        <span className="text-xs">{section}</span>
      </header>
      {children}
      <main className="mx-auto max-w-6xl px-5 py-9 pb-32 md:px-9 md:py-12 md:pb-32">
        <div className="mb-9">
          <p className="label">INSTANCE ADMINISTRATION</p>
          <h1 className="mt-3 text-3xl tracking-tight">{section}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{current.description}</p>
        </div>
        {resetLink && (
          <div className="mb-6 space-y-3 border-l-2 border-primary pl-4">
            <p className="text-sm">
              Reset link expires in 30 minutes. Copy it now and deliver it privately.
            </p>
            <Input
              aria-label="Password reset link"
              readOnly
              value={resetLink}
              onFocus={(e) => e.target.select()}
            />
            <Button variant="outline" size="sm" onClick={() => setResetLink('')}>
              Dismiss
            </Button>
          </div>
        )}
        {!data ? (
          loadError ? (
            <div role="alert" className="space-y-3">
              <p className="text-destructive">{loadError}</p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Loading administration…</p>
          )
        ) : (
          <>
            {data.fields.some((f) => f.section === section) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                  Changes apply on the next page load or request. Session lifetime applies to new
                  sessions.
                  {section === 'Node operations' &&
                    ' Installation policies apply to new requests and setup edits; removal policy applies to new removal requests. Already queued operations continue. Existing node connections are unchanged.'}
                  {section === 'UI defaults' &&
                    ' Language controls locale formatting; interface text is currently English.'}
                </p>
                <div className="divide-y divide-border border-y border-border">
                  {data.fields
                    .filter((f) => f.section === section)
                    .map((f) => {
                      const disabled = f.locked || busy || resets.includes(f.key);
                      const value = draft[f.key] ?? f.value;
                      return (
                        <div
                          key={f.key}
                          className="grid gap-4 py-6 md:grid-cols-[minmax(180px,1fr)_minmax(0,1.25fr)] md:gap-10"
                        >
                          <div>
                            <Label htmlFor={f.key} className="leading-relaxed">
                              {f.label}
                            </Label>
                            <p
                              id={`${f.key}-source`}
                              className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
                            >
                              {f.locked && <LockKeyhole size={12} />}
                              {f.locked ? 'Environment locked' : f.source}
                            </p>
                            {f.key === 'publicUrl' && (
                              <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
                                Changing this immediately changes the login origin. Open the new URL
                                after saving.
                              </p>
                            )}
                          </div>
                          <div className="min-w-0 space-y-3">
                            {typeof f.value === 'boolean' ? (
                              <div className="flex h-10 items-center">
                                <Switch
                                  id={f.key}
                                  aria-describedby={`${f.key}-source`}
                                  disabled={disabled}
                                  checked={Boolean(value)}
                                  onCheckedChange={(checked) =>
                                    setDraft({ ...draft, [f.key]: checked })
                                  }
                                />
                              </div>
                            ) : f.key === 'theme' ? (
                              <Select
                                disabled={disabled}
                                value={String(value)}
                                onValueChange={(v) => setDraft({ ...draft, [f.key]: v })}
                              >
                                <SelectTrigger id={f.key}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="dark">Dark</SelectItem>
                                  <SelectItem value="light">Light</SelectItem>
                                  <SelectItem value="system">System</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : f.key === 'accentColor' ? (
                              <div className="flex items-center gap-3">
                                <Input
                                  aria-label="Accent color picker"
                                  type="color"
                                  disabled={disabled}
                                  value={
                                    /^#[0-9a-f]{6}$/i.test(String(value))
                                      ? String(value)
                                      : String(f.value)
                                  }
                                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                                  className="h-10 w-12 shrink-0 cursor-pointer p-1"
                                />
                                <Input
                                  id={f.key}
                                  disabled={disabled}
                                  value={String(value)}
                                  maxLength={7}
                                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                                />
                              </div>
                            ) : (
                              <Input
                                id={f.key}
                                aria-describedby={`${f.key}-source`}
                                disabled={disabled}
                                type={typeof f.value === 'number' ? 'number' : 'text'}
                                value={String(value)}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    [f.key]:
                                      typeof f.value === 'number'
                                        ? Number(e.target.value)
                                        : e.target.value,
                                  })
                                }
                              />
                            )}
                            {f.locked && (
                              <p className="break-all font-mono text-[11px] text-muted-foreground">
                                {f.env}
                              </p>
                            )}
                            {!f.locked && (f.source === 'Saved' || resets.includes(f.key)) && (
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`${f.key}-reset`}
                                  disabled={busy}
                                  checked={resets.includes(f.key)}
                                  onCheckedChange={(checked) =>
                                    setResets(
                                      checked === true
                                        ? [...resets.filter((k) => k !== f.key), f.key]
                                        : resets.filter((k) => k !== f.key),
                                    )
                                  }
                                />
                                <Label
                                  htmlFor={`${f.key}-reset`}
                                  className="text-xs font-normal text-muted-foreground"
                                >
                                  Restore environment or default value
                                </Label>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </form>
            )}
            {section === 'Users' && (
              <div>
                <Input
                  className="mb-6 max-w-sm"
                  aria-label="Search users"
                  placeholder="Search name or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="divide-y divide-border border-y border-border">
                  {data.users
                    .filter((u) =>
                      `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((u) => (
                      <article key={u.id} className="py-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-medium">
                              {u.name}
                              {u.id === data.actorId && (
                                <span className="ml-2 text-xs text-muted-foreground">You</span>
                              )}
                            </p>
                            <p className="mt-1 break-all text-sm text-muted-foreground">
                              {u.email}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Label
                              htmlFor={`active-${u.id}`}
                              className="text-xs text-muted-foreground"
                            >
                              {u.active ? 'Active' : 'Deactivated'}
                            </Label>
                            <Switch
                              id={`active-${u.id}`}
                              aria-label={`Active account for ${u.email}`}
                              disabled={busy || u.id === data.actorId}
                              checked={u.active}
                              onCheckedChange={(active) =>
                                confirmAction(
                                  active ? 'Reactivate account?' : 'Deactivate account?',
                                  `${u.email}${active ? ' will regain access.' : ' will lose access and all existing sessions. Running streams will continue.'}`,
                                  { action: 'status', userId: u.id, active },
                                )
                              }
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <Select
                            disabled={busy}
                            value={u.instanceRole}
                            onValueChange={(role) =>
                              confirmAction(
                                'Change instance role?',
                                `${u.email} will become ${role === 'admin' ? 'an administrator' : 'a user'}. Their sessions will be revoked.`,
                                { action: 'role', userId: u.id, role },
                              )
                            }
                          >
                            <SelectTrigger aria-label={`Role for ${u.email}`} className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || !u.active}
                            onClick={() => run({ action: 'resetPassword', userId: u.id })}
                          >
                            Create password reset link
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              confirmAction(
                                'Revoke sessions?',
                                `${u.email} will need to sign in again on every device.`,
                                { action: 'revoke', userId: u.id },
                              )
                            }
                          >
                            Revoke sessions
                          </Button>
                        </div>
                      </article>
                    ))}
                </div>
                {!data.users.some((u) =>
                  `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase()),
                ) && <p className="py-8 text-sm text-muted-foreground">No matching users.</p>}
              </div>
            )}
            {section === 'Shared nodes' && (
              <div>
                <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Register a node in your own workspace, then share its ID here. Disabling
                  availability prevents new assignments; existing streams continue.
                </p>
                <div className="mb-8 flex flex-wrap gap-3">
                  <Input
                    className="max-w-md"
                    aria-label="Node ID"
                    placeholder="Node UUID"
                    value={nodeId}
                    onChange={(e) => setNodeId(e.target.value)}
                  />
                  <Button
                    disabled={busy || !nodeId}
                    onClick={() =>
                      run({ action: 'sharedNode', nodeId, shared: true, available: true })
                    }
                  >
                    Share node
                  </Button>
                </div>
                <div className="divide-y divide-border border-y border-border">
                  {data.sharedNodes.map((n) => (
                    <div key={n.id} className="py-6">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="font-medium">{n.name}</p>
                          <p className="text-sm text-muted-foreground">{n.host}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Label htmlFor={`available-${n.id}`}>Available</Label>
                          <Switch
                            id={`available-${n.id}`}
                            disabled={busy}
                            checked={n.available}
                            onCheckedChange={(available) =>
                              run({ action: 'sharedNode', nodeId: n.id, shared: true, available })
                            }
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <code className="break-all text-xs text-muted-foreground">{n.id}</code>
                        <Button
                          size="sm"
                          disabled={busy}
                          variant="ghost"
                          onClick={() =>
                            confirmAction(
                              'Stop sharing node?',
                              'New workspaces will no longer be able to assign channels to this node. Existing channels continue.',
                              {
                                action: 'sharedNode',
                                nodeId: n.id,
                                shared: false,
                                available: false,
                              },
                            )
                          }
                        >
                          Stop sharing
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                {!data.sharedNodes.length && (
                  <p className="py-8 text-sm text-muted-foreground">No shared nodes yet.</p>
                )}
              </div>
            )}
            {section === 'Administration' && (
              <div className="space-y-9">
                <section>
                  <h2 className="mb-3 font-medium">Service health</h2>
                  <dl className="divide-y divide-border border-y border-border">
                    {Object.entries(data.health).map(([k, v]) => (
                      <div className="flex justify-between gap-4 py-3 text-sm" key={k}>
                        <dt className="capitalize">{k}</dt>
                        <dd className="text-muted-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section>
                  <h2 className="mb-3 font-medium">Deployment configuration</h2>
                  <dl className="divide-y divide-border border-y border-border">
                    {data.deployment.map((d) => (
                      <div
                        key={d.name}
                        className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                      >
                        <dt className="break-all font-mono text-xs">{d.name}</dt>
                        <dd className="text-muted-foreground">
                          {d.configured ? 'Configured' : 'Not set'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <Button
                  variant="outline"
                  onClick={() => {
                    const a = document.createElement('a');
                    const url = URL.createObjectURL(
                      new Blob(
                        [
                          JSON.stringify(
                            Object.fromEntries(data.fields.map((f) => [f.key, f.value])),
                            null,
                            2,
                          ),
                        ],
                        { type: 'application/json' },
                      ),
                    );
                    a.href = url;
                    a.download = 'instance-settings.json';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export settings
                </Button>
                <section>
                  <h2 className="mb-4 font-medium">Recent changes</h2>
                  <div className="surface overflow-hidden">
                    <Table aria-label="Recent changes">
                      <TableHeader>
                        <TableRow>
                          {['Time', 'Actor', 'Action', 'Target'].map((h) => (
                            <TableHead key={h}>{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!data.audit.length && (
                          <TableRow>
                            <TableCell
                              colSpan={4}
                              className="py-14 text-center text-muted-foreground"
                            >
                              No changes recorded yet.
                            </TableCell>
                          </TableRow>
                        )}
                        {data.audit.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="whitespace-nowrap">
                              {new Date(a.createdAt).toLocaleString(display.language, {
                                timeZone: display.timezone,
                                hour12: display.hour12,
                              })}
                            </TableCell>
                            <TableCell>
                              {data.users.find((u) => u.id === a.actorId)?.email ?? a.actorId}
                            </TableCell>
                            <TableCell>{a.action}</TableCell>
                            <TableCell className="break-all">
                              {data.users.find((u) => u.id === a.target)?.email ?? a.target}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </main>
      {dirty && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:left-[232px]">
          <div
            role="region"
            aria-label="Unsaved settings"
            className="pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-2xl backdrop-blur"
          >
            <p aria-live="polite" className="text-sm">
              <span className="mr-2 inline-block size-1.5 rounded-full bg-primary" />
              {changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft({});
                  setResets([]);
                }}
              >
                Cancel
              </Button>
              <Button disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle className="text-xl">{confirmation?.title}</DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {confirmation?.description}
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmation(undefined)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const action = confirmation?.action;
                setConfirmation(undefined);
                action?.();
              }}
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
