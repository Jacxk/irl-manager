'use client';
import Image from 'next/image';
import { UserMenu } from './user-menu';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDisplayDefaults } from './instance-display';
import Link from 'next/link';
import { NodeInstaller, useNodeInstallations } from './node-installer';
import { NodeRemoval } from './node-removal';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  Clipboard,
  Eye,
  EyeOff,
  LayoutDashboard,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Server as ServerIcon,
  Settings2,
  ShieldCheck,
  Signal,
  Square,
  Trash2,
  Users,
  Video,
  Waypoints,
  Wifi,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Preview } from './preview';
import { cn } from '@/lib/utils';
import type { DashboardData, Destination, Server } from '@/lib/types';
type View = 'Overview' | 'Channels' | 'Destinations' | 'Scenes' | 'Nodes' | 'Team';
type Modal =
  'channel' | 'node' | 'destination' | 'scene' | 'credentials' | 'member' | 'stop' | null;
const nav: { name: View; icon: LucideIcon }[] = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Channels', icon: Radio },
  { name: 'Destinations', icon: Waypoints },
  { name: 'Scenes', icon: Video },
  { name: 'Nodes', icon: ServerIcon },
  { name: 'Team', icon: Users },
];
const titles: Record<Exclude<Modal, null>, [string, string]> = {
  channel: [
    'Create a channel',
    'Give your stream a home. Connect an encoder, then add destinations.',
  ],
  node: ['Add a node', 'Add a Linux media node, then configure its worker with the node ID.'],
  destination: ['Add a destination', 'Relay your program to another provider at the same time.'],
  scene: ['Fallback scene', 'This scene stays live while your connection recovers.'],
  credentials: [
    'Connect your encoder',
    'Keep these credentials private. Anyone with the key can publish to this channel.',
  ],
  member: [
    'Add a teammate',
    'Your teammate must create an account first. They’ll receive an invitation in their dashboard.',
  ],
  stop: [
    'End this broadcast?',
    'Every destination will disconnect. Provider processing may delay the public end; YouTube requires auto-stop enabled. The worker will stop retrying until you start again.',
  ],
};
function Status({ state }: { state: string }) {
  const active = ['live', 'connected', 'online'].includes(state);
  const warn = [
    'starting',
    'recovering',
    'degraded',
    'fallback',
    'retrying',
    'connecting',
    'ending',
    'installing',
    'checking',
    'waiting',
    'queued check',
    'queued install',
    'awaiting trust',
  ].includes(state);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider',
        active
          ? 'bg-primary/10 text-primary'
          : warn
            ? 'bg-amber-400/10 text-amber-300'
            : 'bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          active ? 'bg-primary' : warn ? 'bg-amber-300' : 'bg-muted-foreground',
        )}
      />
      {state}
    </span>
  );
}
function Provider({ provider }: { provider: string }) {
  return (
    <span
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-xl font-bold text-base',
        provider === 'twitch'
          ? 'bg-violet-400/10 text-violet-300'
          : provider === 'youtube'
            ? 'bg-red-400/10 text-red-400'
            : provider === 'kick'
              ? 'bg-green-400/10 text-green-400'
              : 'bg-sky-400/10 text-sky-300',
      )}
    >
      {provider === 'twitch' ? (
        'T'
      ) : provider === 'youtube' ? (
        <Video size={19} />
      ) : provider === 'kick' ? (
        'K'
      ) : (
        <Route size={19} />
      )}
    </span>
  );
}
function Field({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm text-foreground">{title}</span>
      {children}
      {hint && <span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span>}
    </label>
  );
}
export function Dashboard() {
  const display = useDisplayDefaults();
  const router = useRouter();
  const [now, setNow] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const searchParams = useSearchParams();
  const view =
    nav.find((item) => item.name.toLowerCase() === searchParams.get('view'))?.name ?? 'Overview';
  const setView = (next: View) =>
    router.push(next === 'Overview' ? '/' : `/?view=${next.toLowerCase()}`, { scroll: false });
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [removalNode, setRemovalNode] = useState<Server | null>(null);
  const [credentials, setCredentials] = useState<{
    host: string;
    path: string;
    username: string;
    key: string;
  } | null>(null);
  const [provider, setProvider] = useState('twitch');
  const reload = useCallback(async () => {
    const res = await fetch('/api/control', { cache: 'no-store' });
    if (res.status === 401) {
      router.push('/login');
      router.refresh();
      return;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    setData(json);
    setNow(Date.now());
  }, [router]);
  useEffect(() => {
    let active = true;
    const run = () =>
      reload().catch((e) => {
        if (active) setError(e.message);
      });
    void run();
    const timer = setInterval(run, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [reload]);
  const channel = data?.channels.find((c) => c.id === selected) ?? data?.channels[0];
  const destinations = data?.destinations.filter((d) => d.channelId === channel?.id) ?? [];
  const server = data?.servers.find((s) => s.id === channel?.serverId);
  const active = channel?.desired === 'running';
  const admin = data?.role !== 'operator';
  const installations = useNodeInstallations(!!data && admin);
  const nodeJobs = new Map(installations.jobs.map((job) => [job.nodeId, job]));
  async function command(payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await reload();
      if (payload.action === 'start')
        toast.success('Session requested. Connecting enabled destinations.');
      if (payload.action === 'stop') toast.info('Ending the broadcast on all destinations.');
      if (payload.action === 'fallback')
        toast.info(
          payload.enabled ? 'Fallback scene requested.' : 'Automatic scene switching restored.',
        );
      if (payload.action === 'toggleDestination')
        toast.success(payload.enabled ? 'Destination enabled.' : 'Destination disabled.');
      if (payload.action === 'deleteDestination') toast.success('Destination removed.');
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.';
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function open(value: Modal) {
    setError('');
    if (
      value === 'node' &&
      !installations.jobs.some(
        (j) => j.id === installationId && j.status !== 'complete' && j.operation !== 'remove',
      )
    )
      setInstallationId(
        installations.jobs.find((j) => j.status !== 'complete' && j.operation !== 'remove')?.id ??
          null,
      );
    setModal(value);
  }
  async function showCredentials() {
    const result = await command({ action: 'credentials', channelId: channel?.id });
    if (result) {
      setCredentials(result);
      open('credentials');
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    let payload: Record<string, unknown> = {};
    if (modal === 'channel') payload = { action: 'createChannel', ...values };
    if (modal === 'destination')
      payload = {
        action: 'addDestination',
        channelId: channel?.id,
        ...values,
        autoStopConfirmed: values.autoStopConfirmed === 'on',
      };
    if (modal === 'scene')
      payload = {
        action: 'scene',
        channelId: channel?.id,
        ...values,
        graceSeconds: Number(values.graceSeconds),
      };
    if (modal === 'member') payload = { action: 'addMember', ...values };
    if (await command(payload)) {
      setModal(null);
      toast.success(
        modal === 'member'
          ? 'Invitation created. Your teammate can accept it in their dashboard.'
          : 'Changes saved.',
      );
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied to clipboard.');
    } catch {
      setError('Clipboard unavailable. Select and copy the value manually.');
    }
  }
  const online = (heartbeat: string | null) =>
    !!heartbeat && now - new Date(heartbeat).getTime() < 15000;
  if (!data)
    return (
      <main className="grid min-h-dvh place-items-center">
        <div className="text-center space-y-4">
          <Radio className="mx-auto text-primary" size={32} />
          <p>{error || 'Opening your control room…'}</p>
          {error && (
            <Button onClick={() => void reload().catch((e) => setError(e.message))}>Retry</Button>
          )}
        </div>
      </main>
    );
  const panelHeader = (title: string, sub: string, action?: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 mb-5">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </div>
      {action}
    </div>
  );
  const destCard = (d: Destination) => (
    <div
      key={d.id}
      className="flex items-center gap-3 rounded-xl border border-border bg-background/30 p-4"
    >
      <Provider provider={d.provider} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium truncate">{d.name}</span>
          <Status state={d.enabled ? d.status : 'disabled'} />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground capitalize">
          {d.provider === 'custom' ? 'Custom RTMP' : d.provider}
          {d.retries > 0 ? ` · ${d.retries} retries` : ''}
        </p>
        {d.lastError && <p className="mt-1 text-xs text-destructive">{d.lastError}</p>}
      </div>
      <Switch
        aria-label={`Enable ${d.name}`}
        checked={d.enabled}
        disabled={busy}
        onCheckedChange={(enabled) =>
          void command({
            action: 'toggleDestination',
            channelId: d.channelId,
            destinationId: d.id,
            enabled,
          })
        }
      />
      {admin && data?.channels.find((c) => c.id === d.channelId)?.desired !== 'running' && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${d.name}`}
          onClick={() =>
            void command({
              action: 'deleteDestination',
              channelId: d.channelId,
              destinationId: d.id,
            })
          }
        >
          <Trash2 size={14} />
        </Button>
      )}
    </div>
  );
  return (
    <div className="min-h-dvh lg:pl-[232px]">
      {mobile && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r border-border bg-card transition-transform lg:translate-x-0',
          mobile ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Link
          href="/"
          className="flex h-[84px] items-center gap-2.5 px-6 text-lg font-semibold tracking-tight"
        >
          {display.logoUrl ? (
            <Image unoptimized src={display.logoUrl} alt="" width={32} height={32} />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Radio size={20} />
            </span>
          )}
          <span className="truncate">{display.instanceName}</span>
        </Link>
        <div className="mx-4 mb-7 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-md bg-muted text-xs font-semibold">
              {data.workspace.name[0].toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{data.workspace.name}</p>
              <p className="text-[10px] text-muted-foreground capitalize mt-0.5">
                {data.role} access
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 label mb-3">WORKSPACE</div>
        <nav className="space-y-1 px-3">
          {nav.map((item) => (
            <button
              key={item.name}
              onClick={() => {
                setView(item.name);
                setMobile(false);
              }}
              className={cn(
                'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] transition',
                view === item.name
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <item.icon size={17} />
              {item.name}
              {item.name === 'Channels' && (
                <span className="ml-auto text-[10px] opacity-70">{data.channels.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto p-4">
          <div className="rounded-xl border border-border bg-gradient-to-br from-primary/10 to-card p-4">
            <ShieldCheck size={19} className="text-primary mb-3" />
            <p className="text-xs font-medium">A little peace of mind.</p>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Fallback scenes keep your audience with you when the road gets rough.
            </p>
            <button
              onClick={() => setView('Scenes')}
              className="mt-3 text-[11px] text-primary flex items-center gap-2"
            >
              Manage scenes <ArrowUpRight size={13} />
            </button>
          </div>
          <UserMenu user={data.user} />
        </div>
      </aside>
      <header className="h-[70px] border-b border-border flex items-center justify-between px-5 md:px-9">
        <div className="flex items-center gap-3">
          <button
            className="lg:hidden text-muted-foreground"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <span className="text-xs text-muted-foreground hidden sm:inline">Workspace</span>
          <span className="text-border hidden sm:inline">/</span>
          <span className="text-xs">{view}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className={cn(
                'size-1.5 rounded-full',
                data.servers.some((s) => online(s.heartbeatAt))
                  ? 'bg-primary'
                  : 'bg-muted-foreground',
              )}
            />
            {data.servers.some((s) => online(s.heartbeatAt))
              ? 'Node connected'
              : 'No nodes connected'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh dashboard"
            onClick={() => void reload().catch((e) => setError(e.message))}
          >
            <RefreshCw size={15} />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1560px] p-5 md:p-9 fade-in">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label mb-2">YOUR STREAM, EVERYWHERE</p>
            <h1 className="text-[29px] font-medium tracking-tight">
              {view === 'Overview'
                ? 'Your control room.'
                : view === 'Channels'
                  ? 'Every stream starts here.'
                  : view === 'Destinations'
                    ? 'One stream. Every audience.'
                    : view === 'Scenes'
                      ? 'Stay present. Even offline.'
                      : view === 'Nodes'
                        ? 'The engine behind your stream.'
                        : 'Better, together.'}
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {view === 'Overview'
                ? 'A clear view of everything between you and your audience.'
                : view === 'Channels'
                  ? 'Manage your ingest connections and broadcast sessions.'
                  : view === 'Destinations'
                    ? 'Send your program to multiple platforms simultaneously.'
                    : view === 'Scenes'
                      ? 'Custom scenes for the moments between connections.'
                      : view === 'Nodes'
                        ? 'Register media nodes and monitor worker availability.'
                        : 'Give your crew a seat in the control room.'}
            </p>
          </div>
          {admin && (view !== 'Team' || data.role === 'owner') && (
            <Button
              onClick={() =>
                open(
                  view === 'Nodes'
                    ? 'node'
                    : view === 'Team'
                      ? 'member'
                      : view === 'Destinations'
                        ? 'destination'
                        : view === 'Scenes'
                          ? 'scene'
                          : 'channel',
                )
              }
              disabled={
                ((view === 'Destinations' || view === 'Scenes') && (!channel || active)) ||
                ((view === 'Overview' || view === 'Channels') && !data.servers.length)
              }
            >
              <Plus size={15} />
              {view === 'Nodes'
                ? 'Add node'
                : view === 'Team'
                  ? 'Add teammate'
                  : view === 'Destinations'
                    ? 'Add destination'
                    : view === 'Scenes'
                      ? 'Edit scene'
                      : 'Create channel'}
            </Button>
          )}
        </div>
        {data.invitations.map((invite) => (
          <div
            key={invite.id}
            className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
          >
            <p className="text-sm">
              You’ve been invited to <strong>{invite.workspaceName}</strong> as {invite.role}.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void command({ action: 'declineInvitation', invitationId: invite.id })
                }
              >
                Decline
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void command({ action: 'acceptInvitation', invitationId: invite.id })
                }
              >
                Join workspace
              </Button>
            </div>
          </div>
        ))}
        {error && !modal && (
          <div
            role="alert"
            className="mb-5 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error}
            <button onClick={() => setError('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {view !== 'Nodes' && !data.servers.some((node) => online(node.heartbeatAt)) && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm"
          >
            <ServerIcon size={18} className="shrink-0 text-amber-300" />
            <p className="flex-1 text-muted-foreground">
              <span className="font-medium text-foreground">No nodes connected.</span>{' '}
              {data.servers.length
                ? 'Connect an existing node or add a new one to receive and relay streams.'
                : 'Add a node to receive and relay streams.'}
            </p>
            <Link
              href="/?view=nodes"
              className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
            >
              {admin ? 'Set up a node' : 'View nodes'}
              <ArrowUpRight size={14} />
            </Link>
          </div>
        )}
        {view === 'Overview' && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-8">
            {[
              {
                label: 'ACTIVE CHANNELS',
                value: data.channels.filter((c) => c.desired === 'running').length,
                detail: `${data.channels.length} channels in your workspace`,
                icon: Radio,
              },
              {
                label: 'LIVE DESTINATIONS',
                value: data.destinations.filter((d) => d.status === 'connected').length,
                detail: `${data.destinations.filter((d) => d.enabled).length} destinations enabled`,
                icon: Waypoints,
              },
              {
                label: 'FALLBACK PROTECTION',
                value: data.channels.filter((c) => c.state === 'fallback').length
                  ? 'Active'
                  : 'Ready',
                detail: 'Automatic scene switching',
                icon: ShieldCheck,
              },
              {
                label: 'MEDIA NODES',
                value: `${data.servers.filter((s) => online(s.heartbeatAt)).length} / ${data.servers.length}`,
                detail: 'Nodes currently connected',
                icon: ServerIcon,
              },
            ].map((stat) => (
              <div className="surface p-4 md:p-5" key={stat.label}>
                <div className="flex items-center justify-between gap-2">
                  <span className="label text-[9px]">{stat.label}</span>
                  <stat.icon size={15} className="text-muted-foreground" />
                </div>
                <p className="mt-4 mb-2 text-[28px] leading-none font-medium tracking-tight">
                  {stat.value}
                </p>
                <p className="text-[11px] text-muted-foreground">{stat.detail}</p>
              </div>
            ))}
          </div>
        )}
        {(view === 'Overview' || view === 'Channels') && (
          <>
            {!channel ? (
              <div className="surface dot-grid p-12 md:p-20 text-center">
                <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-5">
                  <Radio size={30} />
                </span>
                <h2 className="text-xl">Your next adventure starts here.</h2>
                <p className="max-w-md mx-auto text-muted-foreground leading-relaxed mt-3">
                  {data.servers.length
                    ? 'Create a channel and connect your favorite streaming destinations. We’ll keep everything in view.'
                    : 'Connect a node to get started, then create a channel and choose where to broadcast.'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-5">
                  {data.channels.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelected(c.id);
                        setPreview(false);
                      }}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs',
                        c.id === channel.id
                          ? 'border-primary/30 bg-primary/5 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Radio size={13} />
                      {c.name}
                      <span
                        className={cn(
                          'size-1 rounded-full',
                          c.desired === 'running' ? 'bg-primary' : 'bg-muted-foreground',
                        )}
                      />
                    </button>
                  ))}
                </div>
                <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-5">
                  <section className="surface overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
                      <div className="flex items-center gap-3">
                        <h2 className="text-sm font-medium">{channel.name}</h2>
                        <Status state={channel.state} />
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {channel.protocol} / PROGRAM OUTPUT
                      </span>
                    </div>
                    <div className="relative aspect-video min-h-[230px] overflow-hidden dot-grid bg-[#0c100d]">
                      {preview && active ? (
                        <Preview key={channel.sessionId} channelId={channel.id} />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
                          <div className="relative mb-6 grid size-16 place-items-center rounded-full border border-primary/15 bg-primary/5 text-primary">
                            <Radio size={27} />
                            <span className="absolute -inset-4 rounded-full border border-primary/5" />
                          </div>
                          <h3 className="text-2xl font-medium tracking-tight">
                            {active ? 'Your stream is in motion.' : 'A window to your world.'}
                          </h3>
                          <p className="max-w-sm mt-3 text-xs leading-relaxed text-muted-foreground">
                            {active
                              ? 'Turn on the preview to see exactly what your audience sees.'
                              : 'Start a session to connect your audience. Preview stays off until you need it.'}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-6"
                            disabled={!active}
                            onClick={() => setPreview(true)}
                          >
                            <Eye size={14} />
                            Enable preview
                          </Button>
                        </div>
                      )}
                      <div className="absolute top-4 left-4 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[9px] tracking-widest text-white/60">
                        {preview && active ? 'PROGRAM PREVIEW' : 'PREVIEW OFF'}
                      </div>
                      {preview && (
                        <button
                          onClick={() => setPreview(false)}
                          aria-label="Disable preview"
                          className="absolute top-4 right-4 rounded-md bg-black/70 p-2 text-white"
                        >
                          <EyeOff size={14} />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border">
                      <div className="flex gap-4 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Signal size={13} />{' '}
                          {channel.state === 'live'
                            ? 'Input healthy'
                            : channel.state === 'fallback'
                              ? 'Fallback active'
                              : 'Awaiting live input'}
                        </span>
                        <span className="hidden sm:flex items-center gap-1.5">
                          <ServerIcon size={13} />
                          {server?.name}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!active || busy}
                          onClick={() =>
                            void command({
                              action: 'fallback',
                              channelId: channel.id,
                              enabled: !channel.manualFallback,
                            })
                          }
                        >
                          <ShieldCheck size={13} />
                          {channel.manualFallback ? 'Resume auto' : 'Use fallback'}
                        </Button>
                        <Button
                          size="sm"
                          variant={active ? 'destructive' : 'default'}
                          disabled={busy || channel.state === 'ending'}
                          onClick={() =>
                            active
                              ? open('stop')
                              : void command({ action: 'start', channelId: channel.id })
                          }
                        >
                          {active ? <Square size={12} /> : <Radio size={13} />}{' '}
                          {active ? 'End stream' : 'Go live'}
                        </Button>
                      </div>
                    </div>
                  </section>
                  <section className="surface p-5 flex flex-col">
                    {panelHeader(
                      'Destinations',
                      'One program. Multiple platforms.',
                      admin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={active}
                          aria-label="Add destination"
                          onClick={() => open('destination')}
                        >
                          <Plus size={16} />
                        </Button>
                      ),
                    )}
                    <div className="space-y-3">
                      {destinations.length ? (
                        destinations.map(destCard)
                      ) : (
                        <div className="rounded-xl border border-dashed border-border px-5 py-9 text-center">
                          <Waypoints size={26} className="mx-auto mb-3 text-muted-foreground" />
                          <p className="text-sm">Find your audience.</p>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            Add Twitch, YouTube, Kick, or your own RTMP endpoint.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-5"
                            disabled={!admin}
                            onClick={() => open('destination')}
                          >
                            <Plus size={13} />
                            Add destination
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="mt-auto pt-5">
                      <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
                        <Route size={15} className="shrink-0 text-primary mt-0.5" />
                        All enabled destinations receive the same program. Each connection retries
                        independently.
                      </div>
                    </div>
                  </section>
                </div>
                <div className="grid lg:grid-cols-[1fr_1fr] xl:grid-cols-[minmax(0,1fr)_340px] gap-5 mt-5">
                  <section className="surface p-5">
                    {panelHeader('Connection & protection', 'Your input, with a safety net.')}
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-border p-4">
                        <div className="flex items-center justify-between">
                          <span className="label">INGEST CONNECTION</span>
                          <ArrowDownToLine size={14} className="text-muted-foreground" />
                        </div>
                        <p className="mt-4 text-sm uppercase">{channel.protocol}</p>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground truncate">
                          {server?.host}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-4"
                          onClick={() => void showCredentials()}
                        >
                          <Settings2 size={12} />
                          Connection details
                        </Button>
                      </div>
                      <div className="rounded-xl border border-border p-4">
                        <div className="flex items-center justify-between">
                          <span className="label">FALLBACK SCENE</span>
                          <ShieldCheck size={14} className="text-primary" />
                        </div>
                        <p className="mt-4 text-sm truncate">{channel.sceneTitle}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Auto-end after {channel.graceSeconds}s without input
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-4"
                          disabled={active}
                          onClick={() => open('scene')}
                        >
                          <Video size={12} />
                          Edit scene
                        </Button>
                      </div>
                    </div>
                  </section>
                  <section className="surface p-5">
                    {panelHeader('Activity', 'The latest from your channel.')}
                    <div className="space-y-4 max-h-52 overflow-auto">
                      {data.events
                        .filter((e) => e.channelId === channel.id)
                        .slice(0, 8)
                        .map((e) => (
                          <div key={e.id} className="flex gap-3">
                            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/50" />
                            <div>
                              <p className="text-xs leading-relaxed">{e.message}</p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {new Date(e.createdAt).toLocaleTimeString(display.language, {
                                  timeZone: display.timezone,
                                  hour12: display.hour12,
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </div>
                        ))}
                      {!data.events.some((e) => e.channelId === channel.id) && (
                        <p className="text-xs leading-relaxed text-muted-foreground py-4">
                          A quiet control room. Session events will appear here when you go live.
                        </p>
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}
          </>
        )}
        {view === 'Destinations' && (
          <section className="surface p-6">
            {panelHeader(
              'Broadcast destinations',
              `${data.destinations.length} connections across your workspace`,
            )}
            <div className="grid lg:grid-cols-2 gap-6">
              {data.channels.map((c) => (
                <div key={c.id}>
                  <button
                    className="mb-3 flex items-center gap-2 text-sm"
                    onClick={() => {
                      setSelected(c.id);
                      setView('Overview');
                    }}
                  >
                    <Radio size={14} className="text-primary" />
                    {c.name}
                    <ArrowUpRight size={13} />
                  </button>
                  <div className="space-y-3">
                    {data.destinations.filter((d) => d.channelId === c.id).map(destCard)}
                    <Button
                      variant="outline"
                      className="w-full border-dashed"
                      disabled={!admin || c.desired === 'running'}
                      onClick={() => {
                        setSelected(c.id);
                        open('destination');
                      }}
                    >
                      <Plus size={14} />
                      Add destination
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {!data.channels.length && (
              <p className="text-muted-foreground py-12 text-center">
                Create a channel to add streaming destinations.
              </p>
            )}
          </section>
        )}
        {view === 'Scenes' && (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
            {data.channels.map((c) => (
              <div key={c.id} className="surface overflow-hidden">
                <div
                  style={{ backgroundColor: c.sceneColor }}
                  className="aspect-video flex flex-col items-center justify-center p-6 text-center"
                >
                  <span className="text-[9px] text-white/40 font-mono tracking-widest mb-5">
                    CONNECTION RECOVERING
                  </span>
                  <Wifi size={25} className="mb-4 text-white/70" />
                  <h2 className="text-xl font-medium text-white">{c.sceneTitle}</h2>
                  <p className="mt-2 text-xs text-white/60">{c.sceneSubtitle}</p>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {c.graceSeconds}s reconnection window
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={c.desired === 'running'}
                    onClick={() => {
                      setSelected(c.id);
                      open('scene');
                    }}
                  >
                    Edit scene
                  </Button>
                </div>
              </div>
            ))}
            {!data.channels.length && (
              <p className="text-muted-foreground py-12">
                Create a channel to customize its fallback scene.
              </p>
            )}
          </div>
        )}
        {view === 'Nodes' && (
          <section className="surface overflow-hidden">
            <div className="overflow-x-auto">
              <Table aria-label="Media nodes">
                <TableHeader>
                  <TableRow>
                    {['Node', 'Region', 'Status', 'Node ID', 'Actions'].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.servers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ServerIcon size={18} className="text-muted-foreground" />
                          <div>
                            <p className="text-sm">{s.name}</p>
                            <p className="text-xs text-muted-foreground mt-1">{s.host}</p>
                            {nodeJobs.get(s.id) && nodeJobs.get(s.id)?.status !== 'complete' && (
                              <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                                {nodeJobs.get(s.id)?.status === 'draft'
                                  ? 'Setup draft'
                                  : nodeJobs.get(s.id)?.step === 'install'
                                    ? 'Waiting for the installer…'
                                    : nodeJobs.get(s.id)?.step}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.region}</TableCell>
                      <TableCell>
                        <Status
                          state={
                            online(s.heartbeatAt)
                              ? 'online'
                              : nodeJobs.get(s.id) && nodeJobs.get(s.id)?.status !== 'complete'
                                ? nodeJobs.get(s.id)!.status.replaceAll('_', ' ')
                                : 'offline'
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          className="font-mono text-xs text-muted-foreground hover:text-primary flex gap-2 items-center"
                          onClick={() => void copy(s.id)}
                        >
                          {s.id.slice(0, 8)}…<Clipboard size={13} />
                        </button>
                      </TableCell>
                      <TableCell>
                        {admin && nodeJobs.get(s.id) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (nodeJobs.get(s.id)?.operation === 'remove') {
                                setRemovalNode(s);
                                return;
                              }
                              setInstallationId(nodeJobs.get(s.id)!.id);
                              setModal('node');
                            }}
                          >
                            {nodeJobs.get(s.id)?.operation === 'remove'
                              ? 'View removal'
                              : nodeJobs.get(s.id)?.status === 'complete'
                                ? 'View setup'
                                : 'Resume setup'}
                          </Button>
                        )}
                        {admin && (
                          <Button
                            variant="destructive"
                            size="icon"
                            className="ml-2"
                            aria-label={`Permanently remove ${s.name}`}
                            onClick={() => setRemovalNode(s)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!data.servers.length && (
              <div className="text-center p-14">
                <ServerIcon size={30} className="mx-auto text-muted-foreground mb-4" />
                <p>No nodes yet.</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Choose local installation or use SSH to set up a remote machine.
                </p>
              </div>
            )}
            <div className="p-5 bg-muted/20 text-xs text-muted-foreground flex items-start gap-2">
              <CircleHelp size={15} className="shrink-0" />
              Installation runs in the background. Resume any setup to see its current step and
              logs. Each Docker host can have one managed node.
            </div>
          </section>
        )}
        {view === 'Team' && (
          <section className="surface p-5">
            {panelHeader('Your crew', data.workspace.name)}
            <div className="space-y-2">
              {data.members.map((m) => (
                <div
                  className="flex items-center gap-3 rounded-lg border border-border p-4"
                  key={m.id}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs">
                    {m.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{m.name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-1">{m.email}</p>
                  </div>
                  <span className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground uppercase">
                    {m.role}
                  </span>
                  {data.role === 'owner' && m.role !== 'owner' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => void command({ action: 'removeMember', memberId: m.id })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <footer className="mt-9 border-t border-border pt-5 flex flex-wrap gap-3 items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Radio size={12} /> IRL MANAGER <span className="mx-1 text-border">/</span> Built for
            the world outside.
          </span>
          <span>Live status refreshes every 4 seconds</span>
        </footer>
      </main>
      <NodeRemoval
        key={removalNode?.id ?? 'none'}
        node={removalNode}
        onClose={() => setRemovalNode(null)}
        onRemoved={() => {
          setRemovalNode(null);
          void reload().catch((e) => toast.error(e.message));
          void installations.refresh();
        }}
        onQueued={(id) => {
          installations.markRemoving(id);
          void installations.refresh();
          void reload().catch((e) => toast.error(e.message));
        }}
      />
      <NodeInstaller
        open={modal === 'node'}
        onClose={() => {
          setModal(null);
          void reload().catch((e) => toast.error(e.message));
        }}
        selectedId={installationId}
        onSelect={setInstallationId}
        data={installations}
        onReady={() => setView('Channels')}
      />
      <Dialog
        open={!!modal && modal !== 'node'}
        onOpenChange={(value) => {
          if (!value) {
            setModal(null);
            setCredentials(null);
            setError('');
          }
        }}
      >
        <DialogContent>
          {modal && (
            <>
              <DialogTitle className="pr-7 text-xl font-medium tracking-tight">
                {titles[modal][0]}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {titles[modal][1]}
              </DialogDescription>
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              {modal === 'credentials' && credentials ? (
                <div className="space-y-4 mt-6">
                  <div className="rounded-lg border border-border p-3 font-mono text-[11px] break-all select-all space-y-3">
                    <p className="text-muted-foreground">RTMP endpoint</p>
                    <p>rtmp://{credentials.host}:1935</p>
                    <p className="text-muted-foreground">RTMP stream key</p>
                    <p>
                      {credentials.path}?user={credentials.username}&amp;pass={credentials.key}
                    </p>
                    <p className="text-muted-foreground">SRT URL</p>
                    <p>
                      srt://{credentials.host}:8890?streamid=publish:{credentials.path}:
                      {credentials.username}:{credentials.key}
                    </p>
                    <p className="text-muted-foreground">SRTLA receiver</p>
                    <p>{credentials.host}:5000 · Use the same SRT stream ID above.</p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      void copy(
                        `srt://${credentials.host}:8890?streamid=publish:${credentials.path}:${credentials.username}:${credentials.key}`,
                      )
                    }
                  >
                    <Clipboard size={14} />
                    Copy SRT URL
                  </Button>
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={active || busy || !admin}
                    onClick={async () => {
                      if (await command({ action: 'rotateKey', channelId: channel?.id })) {
                        setModal(null);
                        setCredentials(null);
                        toast.success(
                          'Ingest key rotated. Reopen connection details for the new key.',
                        );
                      }
                    }}
                  >
                    Rotate ingest key
                  </Button>
                </div>
              ) : modal === 'stop' ? (
                <div className="flex justify-end gap-3 mt-7">
                  <Button variant="outline" onClick={() => setModal(null)}>
                    Keep streaming
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={async () => {
                      if (await command({ action: 'stop', channelId: channel?.id })) {
                        setModal(null);
                        setPreview(false);
                      }
                    }}
                  >
                    <Square size={13} />
                    End all destinations
                  </Button>
                </div>
              ) : (
                <form onSubmit={submit} className="mt-6 space-y-4">
                  {modal === 'channel' && (
                    <>
                      <Field title="Channel name">
                        <Input
                          name="name"
                          placeholder="Weekend adventures"
                          required
                          maxLength={80}
                        />
                      </Field>
                      <Field title="Media node">
                        <select name="serverId" required defaultValue={data.servers[0]?.id}>
                          {!data.servers.length && <option value="">Add a node first</option>}
                          {data.servers.map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        title="Preferred ingest protocol"
                        hint="All three protocols remain available for this channel."
                      >
                        <select name="protocol" defaultValue="srtla">
                          <option value="srtla">SRTLA · Bonded connection</option>
                          <option value="srt">SRT · Reliable transport</option>
                          <option value="rtmp">RTMP · Broad compatibility</option>
                        </select>
                      </Field>
                    </>
                  )}
                  {modal === 'destination' && (
                    <>
                      <Field title="Destination name">
                        <Input
                          name="name"
                          placeholder="My Twitch channel"
                          required
                          maxLength={80}
                        />
                      </Field>
                      <Field title="Provider">
                        <select
                          name="provider"
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                        >
                          <option value="twitch">Twitch</option>
                          <option value="youtube">YouTube</option>
                          <option value="kick">Kick</option>
                          <option value="custom">Custom RTMP / RTMPS</option>
                        </select>
                      </Field>
                      <Field
                        title="Ingest URL"
                        hint="Use the ingest URL from your provider’s streaming dashboard."
                      >
                        <Input
                          key={provider}
                          name="url"
                          placeholder="rtmps://your-provider.example/app"
                          required
                        />
                      </Field>
                      <Field
                        title="Stream key"
                        hint="Encrypted at rest. Keys are never returned to the dashboard."
                      >
                        <Input
                          name="key"
                          type="password"
                          autoComplete="off"
                          placeholder="Your private stream key"
                          required
                        />
                      </Field>
                      {provider === 'youtube' && (
                        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-xs leading-relaxed text-muted-foreground">
                          <input
                            name="autoStopConfirmed"
                            type="checkbox"
                            required
                            className="mt-1 accent-primary"
                          />
                          I enabled auto-stop for this broadcast in YouTube Studio. YouTube may take
                          about a minute to end after the relay disconnects.
                        </label>
                      )}
                    </>
                  )}
                  {modal === 'scene' && channel && (
                    <>
                      <Field title="Headline">
                        <Input
                          name="title"
                          defaultValue={channel.sceneTitle}
                          required
                          maxLength={100}
                        />
                      </Field>
                      <Field title="Supporting text">
                        <Input
                          name="subtitle"
                          defaultValue={channel.sceneSubtitle}
                          maxLength={160}
                        />
                      </Field>
                      <Field title="Background color">
                        <Input type="color" name="color" defaultValue={channel.sceneColor} />
                      </Field>
                      <Field
                        title="Auto-end after no input (seconds)"
                        hint="Unexplained disconnects show this scene until the timeout. End stream stops all outputs immediately."
                      >
                        <Input
                          type="number"
                          name="graceSeconds"
                          min={15}
                          max={3600}
                          defaultValue={channel.graceSeconds}
                          required
                        />
                      </Field>
                    </>
                  )}
                  {modal === 'member' && (
                    <>
                      <Field title="Teammate’s email">
                        <Input name="email" type="email" placeholder="crew@example.com" required />
                      </Field>
                      <Field title="Role">
                        <select name="role" defaultValue="operator">
                          <option value="operator">Operator · Manage live sessions</option>
                          <option value="admin">Admin · Manage channels and nodes</option>
                        </select>
                      </Field>
                    </>
                  )}
                  <div className="pt-3 flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={() => setModal(null)}>
                      Cancel
                    </Button>
                    <Button disabled={busy || (modal === 'channel' && !data.servers.length)}>
                      {busy
                        ? 'Saving…'
                        : modal === 'channel'
                          ? 'Create channel'
                          : modal === 'node'
                            ? 'Add node'
                            : modal === 'destination'
                              ? 'Add destination'
                              : modal === 'member'
                                ? 'Add teammate'
                                : 'Save scene'}
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
