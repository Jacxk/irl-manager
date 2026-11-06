'use client';
import { MoblinControl } from './moblin-control';
import Image from 'next/image';
import { encoderGuide, type IngestProtocol } from '@/lib/ingest';
import { canDeleteChannel } from '@/lib/channel-policy';
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
import { Preview, type PreviewState } from './preview';
import { cn } from '@/lib/utils';
import type { DashboardData, Destination, Server } from '@/lib/types';
type View = 'Overview' | 'Channels' | 'Destinations' | 'Scenes' | 'Nodes' | 'Team';
type Modal =
  | 'channel'
  | 'node'
  | 'destination'
  | 'editDestination'
  | 'editNode'
  | 'scene'
  | 'credentials'
  | 'deleteDestination'
  | 'member'
  | 'stop'
  | 'deleteChannel'
  | null;
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
  editDestination: [
    'Edit destination',
    'The saved stream key stays in place unless you enter a new one.',
  ],
  editNode: [
    'Edit node host',
    'This is the address copied into Moblin. It does not install a node or move the worker.',
  ],
  scene: ['BRB scene', 'Viewers see this while the connection recovers.'],
  credentials: [
    'Connect your encoder',
    'Keep these credentials private. Anyone with the key can publish to this channel. Copy the URL for this channel’s protocol. Use the separate fields only if Moblin asks for them.',
  ],
  member: [
    'Add a teammate',
    'Your teammate must create an account first. They’ll receive an invitation in their dashboard.',
  ],
  deleteChannel: [
    'Delete channel?',
    'Permanently delete this channel, its destinations, credentials, and activity. Stop the broadcast first.',
  ],
  stop: [
    'End this broadcast?',
    'Every destination will disconnect. Provider processing may delay the public end; YouTube requires auto-stop enabled. The worker will stop retrying until you start again.',
  ],
  deleteDestination: [
    'Remove this destination?',
    'The relay stops using it. This does not delete the broadcast on the provider.',
  ],
};
function CopyValue({
  label,
  value,
  hint,
  secret,
  revealed,
  onCopy,
}: {
  label: string;
  value: string;
  hint?: string;
  secret?: boolean;
  revealed?: boolean;
  onCopy: (value: string) => void;
}) {
  const id = `connection-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const shown = !secret || revealed ? value : '•'.repeat(Math.min(value.length, 24));
  return (
    <div className="space-y-2 border-b border-border pb-4">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Copy ${label}`}
          onClick={() => onCopy(value)}
        >
          <Clipboard size={14} />
          Copy
        </Button>
      </div>
      <p id={id} className="font-mono text-[11px] leading-relaxed break-all select-all">
        {shown}
      </p>
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
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
  const managedChannelId = view === 'Channels' ? searchParams.get('channel') : null;
  const details = managedChannelId !== null;
  const channelUrl = (id: string) => `/?view=channels&channel=${encodeURIComponent(id)}`;
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewOverride, setPreview] = useState<boolean | null>(null);
  const [inputStatus, setInputStatus] = useState<{ channelId: string; connected: boolean } | null>(
    null,
  );
  const [previewState, setPreviewState] = useState<PreviewState>('connecting');
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
  const [ingestProtocol, setIngestProtocol] = useState<IngestProtocol>('srtla');
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [pendingDestination, setPendingDestination] = useState<Destination | null>(null);
  const [editingDestination, setEditingDestination] = useState<Destination | null>(null);
  const [pendingServer, setPendingServer] = useState<Server | null>(null);
  const reload = useCallback(async () => {
    const res = await fetch('/api/control', { cache: 'no-store' });
    if (res.status === 401) {
      const next = `${window.location.pathname}${window.location.search}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      router.refresh();
      return;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    setRefreshError('');
    setData(json);
    setNow(Date.now());
  }, [router]);
  useEffect(() => {
    let active = true;
    const run = () =>
      reload().catch((e) => {
        if (active) setRefreshError(e.message);
      });
    void run();
    const timer = setInterval(run, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [reload]);
  const channel = details
    ? data?.channels.find((c) => c.id === managedChannelId)
    : (data?.channels.find((c) => c.id === selected) ?? data?.channels[0]);
  const destinations = data?.destinations.filter((d) => d.channelId === channel?.id) ?? [];
  const server = data?.servers.find((s) => s.id === channel?.serverId);
  const active = channel?.desired === 'running';
  const previewWanted =
    (previewOverride ?? data?.previewOnByDefault ?? true) &&
    (active || data?.allowPreLivePreview !== false);
  const previewChannelId = channel?.id;
  const previewAllowed = active || data?.allowPreLivePreview !== false;
  const inputConnected =
    inputStatus?.channelId === previewChannelId && inputStatus?.connected === true;
  const protectedPreview = !active && !!channel?.previewSessionId;
  const preview = previewWanted && (active || protectedPreview || inputConnected);
  const nodeOnline =
    !!server?.heartbeatAt && now - new Date(server.heartbeatAt).getTime() < 15000;
  useEffect(() => {
    if (!previewChannelId || !previewAllowed || !nodeOnline) return;
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      let connected = false;
      try {
        const response = await fetch(`/api/preview/${previewChannelId}/status.json`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.ok) connected = (await response.json()).connected === true;
      } catch {}
      if (!disposed) {
        setInputStatus({ channelId: previewChannelId!, connected });
        timer = setTimeout(check, 3000);
      }
    }
    void check();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [previewChannelId, previewAllowed, nodeOnline]);
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
      if (payload.action === 'start') setPreview(null);
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
      if (payload.action === 'deleteChannel') toast.success('Channel deleted.');
      if (payload.action === 'deleteDestination') toast.success('Destination removed.');
      if (payload.action === 'updateDestination') toast.success('Destination saved.');
      if (payload.action === 'updateServer') toast.success('Node host saved.');
      if (payload.action === 'removeMember') toast.success('Teammate removed.');
      if (payload.action === 'acceptInvitation') toast.success('Workspace joined.');
      if (payload.action === 'declineInvitation') toast.info('Invitation declined.');
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
  async function showCredentials(channelId = channel?.id) {
    const preferred = data?.channels.find((c) => c.id === channelId)?.protocol;
    setIngestProtocol(preferred === 'srt' || preferred === 'rtmp' ? preferred : 'srtla');
    setRevealSecrets(false);
    setConfirmRotate(false);
    const result = await command({ action: 'credentials', channelId });
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
    if (modal === 'destination' || modal === 'editDestination') {
      const key = String(values.key || '').trim();
      payload = {
        action: modal === 'editDestination' ? 'updateDestination' : 'addDestination',
        channelId:
          modal === 'editDestination' ? editingDestination?.channelId : values.channelId || channel?.id,
        destinationId: editingDestination?.id,
        name: values.name,
        provider: values.provider,
        url: values.url,
        autoStopConfirmed: values.autoStopConfirmed === 'on',
        ...(key ? { key } : {}),
      };
    }
    if (modal === 'editNode')
      payload = {
        action: 'updateServer',
        serverId: pendingServer?.id,
        name: values.name,
        host: values.host,
        region: values.region,
      };
    if (modal === 'scene')
      payload = {
        action: 'scene',
        channelId: channel?.id,
        ...values,
        graceSeconds: Number(values.graceSeconds),
      };
    if (modal === 'member') payload = { action: 'addMember', ...values };
    const result = await command(payload);
    if (result) {
      if (payload.action === 'createChannel' && typeof result.channelId === 'string') {
        setSelected(result.channelId);
        router.replace(channelUrl(result.channelId), { scroll: false });
        toast.success('Channel created. Copy these fields into Moblin.');
        await showCredentials(result.channelId);
        return;
      }
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
          <p role={refreshError ? 'alert' : 'status'}>
            {refreshError || 'Opening your control room…'}
          </p>
          {refreshError && (
            <Button onClick={() => void reload().catch((e) => setRefreshError(e.message))}>
              Retry
            </Button>
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
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/30 p-4"
    >
      <Provider provider={d.provider} />
        <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {admin ? (
            <button
              type="button"
              className="min-h-10 font-medium truncate text-left hover:text-primary"
              onClick={() => {
                setProvider(d.provider);
                setEditingDestination(d);
                open('editDestination');
              }}
            >
              {d.name}
            </button>
          ) : (
            <span className="font-medium truncate">{d.name}</span>
          )}
          <Status state={d.enabled ? d.status : 'disabled'} />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground capitalize">
          {d.provider === 'custom' ? 'Custom RTMP' : d.provider}
          {d.retries > 0 ? ` · ${d.retries} retries` : ''}
        </p>
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{d.url}</p>
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
          onClick={() => {
            setPendingDestination(d);
            open('deleteDestination');
          }}
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
            aria-label="Open navigation"
            className="lg:hidden grid size-11 place-items-center text-muted-foreground"
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
              : data.servers.length === 1
                ? `${data.servers[0]?.name} is offline`
                : data.servers.length
                  ? 'Nodes offline'
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
            <h1 className="text-[29px] font-medium tracking-tight">{view}</h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {view === 'Overview'
                ? 'Node, Moblin, destination, then go live.'
                : view === 'Channels'
                  ? 'Manage ingest, health, and the broadcast.'
                  : view === 'Destinations'
                    ? 'Send the program to more than one platform.'
                    : view === 'Scenes'
                      ? 'The BRB scene viewers see while the connection recovers.'
                      : view === 'Nodes'
                        ? 'Media nodes that receive Moblin and relay the program.'
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
                ((view === 'Overview' || (view === 'Channels' && details)) && !data.servers.length)
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
        {(error || refreshError) && !modal && (
          <div
            role="alert"
            className="mb-5 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error || refreshError}
            <button
              onClick={() => (error ? setError('') : setRefreshError(''))}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!data.servers.some((node) => online(node.heartbeatAt)) && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm"
          >
            <ServerIcon size={18} className="shrink-0 text-amber-300" />
            <p className="flex-1 text-muted-foreground">
              <span className="font-medium text-foreground">
                {data.servers.length === 1
                  ? `${data.servers[0]?.name} is offline.`
                  : data.servers.length
                    ? 'Nodes are offline.'
                    : 'No nodes connected.'}
              </span>{' '}
              {data.servers.length
                ? 'The worker has not checked in. Open the node for its host and last status before a phone can publish.'
                : 'Add a node to receive and relay streams.'}
            </p>
            {view === 'Nodes' && admin && data.servers[0] ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPendingServer(
                    data.servers.find((node) => !online(node.heartbeatAt)) ?? data.servers[0],
                  );
                  open('editNode');
                }}
              >
                Edit node host
              </Button>
            ) : view !== 'Nodes' ? (
              <Link
                href="/?view=nodes"
                className="inline-flex min-h-10 items-center gap-1 text-primary underline underline-offset-4"
              >
                {data.servers.length ? 'Check the node' : admin ? 'Set up a node' : 'View nodes'}
                <ArrowUpRight size={14} />
              </Link>
            ) : null}
          </div>
        )}
        {view === 'Channels' && !details && (
          <section className="surface overflow-x-auto">
            <div className="divide-y divide-border md:hidden">
              {data.channels.map((c) => (
                <div key={c.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={channelUrl(c.id)} className="text-sm font-medium hover:text-primary">
                        {c.name}
                      </Link>
                      <p className="mt-1 text-xs uppercase text-muted-foreground">{c.protocol}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {data.servers.find((s) => s.id === c.serverId)?.name ?? 'No node'} ·{' '}
                        {data.destinations.filter((d) => d.channelId === c.id).length} destinations
                      </p>
                    </div>
                    <Status
                      state={
                        online(data.servers.find((s) => s.id === c.serverId)?.heartbeatAt ?? null)
                          ? c.state
                          : 'offline'
                      }
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" className="flex-1">
                      <Link href={channelUrl(c.id)} scroll={false} aria-label={`Manage ${c.name}`}>
                        Manage
                      </Link>
                    </Button>
                    {admin && (
                      <Button
                        variant="destructive"
                        disabled={busy || !canDeleteChannel(c)}
                        onClick={() => {
                          setSelected(c.id);
                          open('deleteChannel');
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {!data.channels.length && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No channels yet. Create a channel to get started.
                </p>
              )}
            </div>
            <div className="hidden md:block">
            <Table aria-label="Channels">
              <TableHeader>
                <TableRow>
                  {['Channel', 'Node', 'Health', 'Destinations', 'Actions'].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.channels.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      {c.name}
                      <p className="text-xs text-muted-foreground uppercase mt-1">{c.protocol}</p>
                    </TableCell>
                    <TableCell>{data.servers.find((s) => s.id === c.serverId)?.name}</TableCell>
                    <TableCell>
                      <Status
                        state={
                          online(data.servers.find((s) => s.id === c.serverId)?.heartbeatAt ?? null)
                            ? c.state
                            : 'offline'
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {data.destinations.filter((d) => d.channelId === c.id).length}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={channelUrl(c.id)}
                            scroll={false}
                            aria-label={`Manage ${c.name}`}
                          >
                            Manage
                          </Link>
                        </Button>
                        {admin && (
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy || !canDeleteChannel(c)}
                            onClick={() => {
                              setSelected(c.id);
                              open('deleteChannel');
                            }}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!data.channels.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No channels yet. Create a channel to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </section>
        )}
        {view === 'Channels' && details && (
          <Button asChild variant="outline" className="mb-5">
            <Link href="/?view=channels" scroll={false}>
              Back to channels
            </Link>
          </Button>
        )}
        {(view === 'Overview' || (view === 'Channels' && details)) && (
          <>
            {!channel ? (
              <div className="surface dot-grid p-12 md:p-20 text-center">
                <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-5">
                  <Radio size={30} />
                </span>
                <h2 className="text-xl">
                  {details ? 'Channel not found.' : 'Create a channel'}
                </h2>
                <p className="max-w-md mx-auto text-muted-foreground leading-relaxed mt-3">
                  {details
                    ? 'This channel may have been deleted or is not available in this workspace.'
                    : data.servers.length
                      ? 'A channel is the Moblin connection and the program you send to destinations.'
                      : 'Connect a node first, then create a channel and choose where to broadcast.'}
                </p>
                {!details && admin && (
                  <Button className="mt-6" onClick={() => open(data.servers.length ? 'channel' : 'node')}>
                    {data.servers.length ? 'Create channel' : 'Set up a node'}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-5">
                  {data.channels.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        if (details) router.push(channelUrl(c.id), { scroll: false });
                        else setSelected(c.id);
                        setPreview(null);
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
                {view === 'Overview' && (
                  <ol className="mb-5 grid gap-2 text-xs sm:grid-cols-5">
                    {[
                      ['Node online', nodeOnline],
                      ['Channel', true],
                      ['Moblin connected', inputConnected],
                      ['Destination', destinations.some((d) => d.enabled)],
                      ['Live', active],
                    ].map(([label, done], index) => (
                      <li
                        key={String(label)}
                        className="rounded-lg border border-border px-3 py-2 text-muted-foreground"
                      >
                        <span className="text-foreground">
                          {index + 1}. {label}
                        </span>
                        <span className="mt-1 block">{done ? 'Done' : 'Not yet'}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <div
                  className={cn(
                    'grid gap-5',
                    (view === 'Channels' || view === 'Overview') &&
                      'xl:grid-cols-[minmax(0,1fr)_340px]',
                  )}
                >
                  <section className="surface overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
                      <div className="flex items-center gap-3">
                        <h2 className="text-sm font-medium">{channel.name}</h2>
                        <Status state={channel.state} />
                      </div>
                      <Button size="sm" onClick={() => void showCredentials()}>
                        Connect encoder
                      </Button>
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {channel.protocol} / {active ? 'PROGRAM OUTPUT' : 'INCOMING STREAM'}
                      </span>
                    </div>
                    <div
                      className={cn(
                        'relative overflow-hidden dot-grid bg-[#0c100d]',
                        preview ? 'aspect-video' : 'min-h-40',
                      )}
                    >
                      {preview ? (
                        <Preview
                          key={`${channel.id}:${active ? channel.sessionId : protectedPreview ? channel.previewSessionId : 'input'}`}
                          channelId={channel.id}
                          source={active ? 'program' : protectedPreview ? 'preview' : 'input'}
                          onState={setPreviewState}
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
                          <div className="relative mb-6 grid size-16 place-items-center rounded-full border border-primary/15 bg-primary/5 text-primary">
                            <Radio size={27} />
                            <span className="absolute -inset-4 rounded-full border border-primary/5" />
                          </div>
                          <h3 className="text-xl font-medium tracking-tight">
                            {!nodeOnline
                              ? `${server?.name ?? 'The node'} is offline`
                              : !previewAllowed
                                ? 'Preview unavailable'
                                : inputConnected || active || protectedPreview
                                  ? 'Preview is paused.'
                                  : 'No incoming stream'}
                          </h3>
                          <p className="max-w-sm mt-3 text-xs leading-relaxed text-muted-foreground">
                            {!nodeOnline
                              ? 'Reconnect this node before Moblin can send video.'
                              : !previewAllowed
                                ? 'Input preview is disabled by instance policy.'
                                : !inputConnected && !active && !protectedPreview
                                  ? 'Copy the connection details into Moblin. Preview opens when video arrives.'
                                  : 'Turn on preview to watch the incoming stream.'}
                          </p>
                          {nodeOnline && !inputConnected && !active && !protectedPreview && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-4"
                              onClick={() => void showCredentials()}
                            >
                              Connect encoder
                            </Button>
                          )}
                          {(active || protectedPreview || inputConnected) && previewAllowed && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-6"
                              disabled={
                                !previewAllowed || (!active && !protectedPreview && !inputConnected)
                              }
                              onClick={() => setPreview(true)}
                            >
                              <Eye size={14} />
                              Enable preview
                            </Button>
                          )}
                        </div>
                      )}
                      {!preview && (
                        <div className="absolute top-4 left-4 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[9px] tracking-widest text-white/60">
                          PREVIEW OFF
                        </div>
                      )}
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
                    <div
                      className="flex flex-wrap gap-6 p-4 border-t border-border text-xs"
                      aria-label="Stream health"
                    >
                      <div>
                        Receiving ·{' '}
                        <Status
                          state={
                            !online(server?.heartbeatAt ?? null)
                              ? 'offline'
                              : channel.state === 'live'
                                ? 'live'
                                : channel.state
                          }
                        />
                        <p className="mt-2 text-muted-foreground">
                          {active &&
                          online(server?.heartbeatAt ?? null) &&
                          channel.telemetryAt &&
                          now - new Date(channel.telemetryAt).getTime() < 15000 &&
                          channel.receiveKbps !== null
                            ? `${channel.receiveKbps} kbps`
                            : !online(server?.heartbeatAt ?? null)
                              ? `${server?.name ?? 'Node'} is offline`
                              : active
                                ? 'Waiting for Moblin'
                                : 'Starts when you go live'}
                        </p>
                      </div>
                      <div>
                        Sending ·{' '}
                        <Status
                          state={
                            !online(server?.heartbeatAt ?? null)
                              ? 'offline'
                              : destinations.some((d) => d.enabled && d.status === 'retrying')
                                ? 'retrying'
                                : destinations.some((d) => d.enabled && d.status === 'connected')
                                  ? 'connected'
                                  : 'idle'
                          }
                        />
                        <p className="mt-2 text-muted-foreground">
                          {active &&
                          online(server?.heartbeatAt ?? null) &&
                          channel.telemetryAt &&
                          now - new Date(channel.telemetryAt).getTime() < 15000 &&
                          channel.sendKbps !== null
                            ? `${channel.sendKbps} kbps total`
                            : !online(server?.heartbeatAt ?? null)
                              ? `${server?.name ?? 'Node'} is offline`
                              : 'Starts when you go live'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border">
                      <div className="flex gap-4 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Signal size={13} />{' '}
                          {!inputConnected && !active && !protectedPreview
                            ? 'No incoming stream'
                            : protectedPreview
                              ? channel.previewState === 'fallback'
                                ? 'BRB preview · Waiting for input'
                                : channel.previewState === 'live'
                                  ? 'Input connected · Not broadcasting'
                                  : 'Protected preview starting…'
                              : !active
                                ? !preview
                                  ? !inputConnected
                                    ? 'No incoming stream'
                                    : 'Input preview paused'
                                  : previewState === 'playing'
                                    ? 'Input connected · Not live'
                                    : previewState === 'unsupported'
                                      ? 'Preview codec unsupported'
                                      : previewState === 'offline'
                                        ? 'Stream ended'
                                        : previewState === 'paused'
                                          ? 'Preview playback paused'
                                          : previewState === 'connecting'
                                            ? 'Checking incoming video…'
                                            : 'Waiting for incoming video'
                                : channel.state === 'live'
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
                          title={active ? undefined : 'Available after you go live'}
                          onClick={() =>
                            void command({
                              action: 'fallback',
                              channelId: channel.id,
                              enabled: !channel.manualFallback,
                            })
                          }
                        >
                          <ShieldCheck size={13} />
                          {channel.manualFallback ? 'Resume auto' : 'Show BRB'}
                        </Button>
                        <Button
                          size="sm"
                          variant={active ? 'destructive' : 'default'}
                          disabled={
                            busy || channel.state === 'ending' || (!active && !nodeOnline)
                          }
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
                      {!active && (
                        <p className="basis-full text-[11px] text-muted-foreground">
                          {nodeOnline
                            ? 'Show BRB turns on after you go live. You can go live before Moblin connects and before you add a destination.'
                            : `Go live stays off until ${server?.name ?? 'the node'} is online.`}
                        </p>
                      )}
                    </div>
                    <div className="border-t border-border p-4">
                      <MoblinControl
                        key={channel.id}
                        channelId={channel.id}
                        canEdit={admin}
                        broadcastActive={active}
                        protectedPreview={protectedPreview}
                      />
                    </div>
                  </section>
                  {(view === 'Channels' || view === 'Overview') && (
                    <section className="surface p-4 sm:p-5 flex flex-col">
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
                  )}
                </div>
                {view === 'Overview' && (
                  <div className="flex flex-wrap gap-3 mt-5">
                    <Button
                      variant="outline"
                      disabled={active || !admin}
                      onClick={() => open('scene')}
                    >
                      Edit BRB for {channel.name}
                    </Button>
                  </div>
                )}
                {view === 'Channels' && (
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
                )}
              </>
            )}
          </>
        )}
        {view === 'Destinations' && (
          <section className="surface p-4 sm:p-6">
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
                    Edit BRB for {c.name}
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
          <section className="surface overflow-x-auto">
            <div className="divide-y divide-border md:hidden">
              {data.servers.map((s) => (
                <div key={s.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{s.host}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{s.region}</p>
                    </div>
                    <Status
                      state={
                        online(s.heartbeatAt)
                          ? 'online'
                          : nodeJobs.get(s.id) && nodeJobs.get(s.id)?.status !== 'complete'
                            ? nodeJobs.get(s.id)!.status.replaceAll('_', ' ')
                            : 'offline'
                      }
                    />
                  </div>
                  {!online(s.heartbeatAt) && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {s.heartbeatAt
                        ? `Last seen ${new Date(s.heartbeatAt).toLocaleString()}. The worker is not connected.`
                        : 'No heartbeat yet. The worker has not connected to this manager.'}
                    </p>
                  )}
                  <button
                    className="flex min-h-10 items-center gap-2 font-mono text-xs text-muted-foreground"
                    onClick={() => void copy(s.id)}
                  >
                    Copy node ID <Clipboard size={13} />
                  </button>
                  {admin && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setPendingServer(s);
                          open('editNode');
                        }}
                      >
                        Edit host
                      </Button>
                      <Button
                        variant="destructive"
                        aria-label={`Permanently remove ${s.name}`}
                        onClick={() => setRemovalNode(s)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {!data.servers.length && (
                <p className="p-8 text-center text-sm text-muted-foreground">No nodes yet.</p>
              )}
            </div>
            <div className="hidden overflow-x-auto md:block">
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
                      <TableCell className="min-w-64 whitespace-normal">
                        <div className="flex items-center gap-3">
                          <ServerIcon size={18} className="text-muted-foreground" />
                          <div>
                            <p className="text-sm">{s.name}</p>
                            <p className="text-xs text-muted-foreground mt-1">{s.host}</p>
                            {!online(s.heartbeatAt) && (
                              <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                                {s.heartbeatAt
                                  ? `Last seen ${new Date(s.heartbeatAt).toLocaleString()}. The worker is not connected.`
                                  : 'No heartbeat yet. The worker has not connected to this manager.'}
                              </p>
                            )}
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
                            variant="outline"
                            size="sm"
                            className="ml-2"
                            onClick={() => {
                              setPendingServer(s);
                              open('editNode');
                            }}
                          >
                            Edit host
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
              logs. Each Docker host can have one managed node. Edit host changes the address
              phones copy into Moblin. It does not install a node or move the worker.
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
                      disabled={busy}
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
                {modal === 'deleteDestination' && pendingDestination
                  ? `Remove ${pendingDestination.name}?`
                  : modal === 'deleteChannel'
                    ? `Delete ${data.channels.find((item) => item.id === selected)?.name ?? 'this channel'}?`
                    : modal === 'scene' && channel
                      ? `BRB scene for ${channel.name}`
                      : modal === 'editNode' && pendingServer
                        ? `Host for ${pendingServer.name}`
                        : modal === 'editDestination' && editingDestination
                          ? editingDestination.name
                          : titles[modal][0]}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {modal === 'scene' && channel
                  ? `Viewers of ${channel.name} see this while the connection recovers.`
                  : modal === 'deleteDestination' && pendingDestination
                    ? `The relay stops sending to ${pendingDestination.name}. This does not end the broadcast on the provider.`
                    : modal === 'deleteChannel'
                      ? `Permanently delete ${data.channels.find((item) => item.id === selected)?.name ?? 'this channel'}, its destinations, credentials, and activity.`
                      : titles[modal][1]}
              </DialogDescription>
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              {modal === 'credentials' && credentials
                ? (() => {
                    const guide = encoderGuide(credentials, ingestProtocol);
                    return (
                      <div className="mt-6 space-y-4">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {guide.hostNote}
                        </p>
                        {guide.connection.localOnly && admin && server && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setPendingServer(server);
                              setModal('editNode');
                            }}
                          >
                            Edit node host
                          </Button>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {(['srtla', 'srt', 'rtmp'] as const).map((protocol) => (
                            <Button
                              key={protocol}
                              type="button"
                              size="sm"
                              variant={ingestProtocol === protocol ? 'default' : 'outline'}
                              onClick={() => setIngestProtocol(protocol)}
                            >
                              {protocol.toUpperCase()}
                              {channel?.protocol === protocol ? ' · preferred' : ''}
                            </Button>
                          ))}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setRevealSecrets((value) => !value)}
                          >
                            {revealSecrets ? 'Hide secrets' : 'Show secrets'}
                          </Button>
                        </div>
                        <CopyValue
                          label={`${ingestProtocol.toUpperCase()} URL`}
                          value={guide.url}
                          hint={guide.urlHint}
                          secret
                          revealed={revealSecrets}
                          onCopy={(value) => void copy(value)}
                        />
                        {guide.parts.map((field) => (
                          <CopyValue
                            key={field.label}
                            label={field.label}
                            value={field.value}
                            hint={field.hint}
                            secret={field.secret}
                            revealed={revealSecrets}
                            onCopy={(value) => void copy(value)}
                          />
                        ))}
                        {confirmRotate ? (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              className="flex-1"
                              onClick={() => setConfirmRotate(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="destructive"
                              className="flex-1"
                              disabled={active || busy || !admin}
                              onClick={async () => {
                                if (await command({ action: 'rotateKey', channelId: channel?.id })) {
                                  setModal(null);
                                  setCredentials(null);
                                  setConfirmRotate(false);
                                  toast.success(
                                    'Ingest key rotated. Reopen connection details for the new key.',
                                  );
                                }
                              }}
                            >
                              Confirm rotation
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="destructive"
                            className="w-full"
                            disabled={active || busy || !admin}
                            onClick={() => setConfirmRotate(true)}
                          >
                            Rotate ingest key
                          </Button>
                        )}
                      </div>
                    );
                  })()
                : modal === 'deleteDestination' && pendingDestination ? (
                <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button variant="outline" className="w-full sm:w-auto" onClick={() => setModal(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="w-full whitespace-normal sm:w-auto"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await command({
                          action: 'deleteDestination',
                          channelId: pendingDestination.channelId,
                          destinationId: pendingDestination.id,
                        })
                      ) {
                        setPendingDestination(null);
                        setModal(null);
                      }
                    }}
                  >
                    Remove {pendingDestination.name}
                  </Button>
                </div>
              ) : modal === 'deleteChannel' ? (
                <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button variant="outline" className="w-full sm:w-auto" onClick={() => setModal(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="w-full whitespace-normal sm:w-auto"
                    disabled={
                      busy || !data.channels.some((c) => c.id === selected && canDeleteChannel(c))
                    }
                    onClick={async () => {
                      if (await command({ action: 'deleteChannel', channelId: selected })) {
                        setModal(null);
                        setSelected('');
                        router.replace('/?view=channels', { scroll: false });
                      }
                    }}
                  >
                    Delete {data.channels.find((item) => item.id === selected)?.name ?? 'channel'}
                  </Button>
                </div>
              ) : modal === 'stop' ? (
                <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button variant="outline" className="w-full sm:w-auto" onClick={() => setModal(null)}>
                    Keep streaming
                  </Button>
                  <Button
                    variant="destructive"
                    className="w-full whitespace-normal sm:w-auto"
                    disabled={busy}
                    onClick={async () => {
                      if (await command({ action: 'stop', channelId: channel?.id })) {
                        setModal(null);
                      }
                    }}
                  >
                    <Square size={13} />
                    End all destinations
                  </Button>
                </div>
              ) : (
                <form
                  key={`${modal}:${editingDestination?.id ?? ''}:${pendingServer?.id ?? ''}:${channel?.id ?? ''}`}
                  onSubmit={submit}
                  className="mt-6 space-y-4"
                >
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
                              {online(s.heartbeatAt) ? '' : ' (offline)'}
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
                  {(modal === 'destination' || modal === 'editDestination') && (
                    <>
                      {modal === 'editDestination' ? (
                        <p className="text-xs text-muted-foreground">
                          Channel:{' '}
                          {data.channels.find((item) => item.id === editingDestination?.channelId)
                            ?.name ?? 'This channel'}
                        </p>
                      ) : (
                        (data?.channels.length ?? 0) > 1 && (
                          <Field title="Channel">
                            <select
                              name="channelId"
                              defaultValue={channel?.id ?? data?.channels[0]?.id}
                            >
                              {data?.channels.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )
                      )}
                      <Field title="Destination name">
                        <Input
                          name="name"
                          defaultValue={
                            modal === 'editDestination' ? editingDestination?.name : undefined
                          }
                          placeholder={
                            provider === 'youtube'
                              ? 'My YouTube channel'
                              : provider === 'kick'
                                ? 'My Kick channel'
                                : provider === 'custom'
                                  ? 'My RTMP destination'
                                  : 'My Twitch channel'
                          }
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
                          key={modal === 'editDestination' ? editingDestination?.id : provider}
                          name="url"
                          defaultValue={
                            modal === 'editDestination' ? editingDestination?.url : undefined
                          }
                          placeholder={
                            provider === 'twitch'
                              ? 'rtmp://live.twitch.tv/app'
                              : provider === 'youtube'
                                ? 'rtmp://a.rtmp.youtube.com/live2'
                                : provider === 'kick'
                                  ? 'rtmps://fa723fc1b171.global-contribute.live-video.net/app'
                                  : 'rtmps://your-provider.example/app'
                          }
                          required
                        />
                      </Field>
                      <Field
                        title="Stream key"
                        hint={
                          modal === 'editDestination'
                            ? 'Leave this blank to keep the saved key. Keys are never shown again.'
                            : 'Encrypted at rest. Keys are never returned to the dashboard.'
                        }
                      >
                        <Input
                          name="key"
                          type="password"
                          autoComplete="off"
                          placeholder={
                            modal === 'editDestination'
                              ? 'Saved key stays unless you replace it'
                              : 'Your private stream key'
                          }
                          required={modal === 'destination'}
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
                  {modal === 'editNode' && pendingServer && (
                    <>
                      <Field title="Node name">
                        <Input name="name" defaultValue={pendingServer.name} required maxLength={80} />
                      </Field>
                      <Field
                        title="Address phones use"
                        hint="A hostname or IPv4 address the phone can reach. Saving this updates the URLs in Connection details. It does not move the worker."
                      >
                        <Input
                          name="host"
                          defaultValue={pendingServer.host}
                          required
                          pattern="[a-zA-Z0-9.-]+"
                        />
                      </Field>
                      <Field title="Region">
                        <Input
                          name="region"
                          defaultValue={pendingServer.region}
                          required
                          maxLength={60}
                        />
                      </Field>
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
                  <div className="flex flex-col-reverse gap-3 pt-3 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => setModal(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="w-full whitespace-normal sm:w-auto"
                      disabled={busy || (modal === 'channel' && !data.servers.length)}
                    >
                      {busy
                        ? 'Saving…'
                        : modal === 'channel'
                          ? 'Create channel'
                          : modal === 'node'
                            ? 'Add node'
                            : modal === 'destination'
                              ? 'Add destination'
                              : modal === 'editDestination'
                                ? 'Save destination'
                                : modal === 'editNode'
                                  ? 'Save host'
                                  : modal === 'member'
                                    ? 'Add teammate'
                                    : 'Save BRB'}
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
