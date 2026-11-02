'use client';
import { useEffect, useRef, useState } from 'react';
import { Copy, Smartphone, Eye, EyeOff, Link2, Unlink, CircleHelp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
type Config = {
  enabled: boolean;
  syncBroadcast: boolean;
  lowBitrateKbps: number;
  lowBitrateSeconds: number;
  recoverySeconds: number;
};
type Data = {
  revision: number;
  allowed: boolean;
  gatewayReady: boolean;
  endpoint: string;
  endpointError?: string;
  connected: boolean;
  streaming: boolean | null;
  bitrateKbps: number | null;
  lastError: string | null;
  config: Config;
};
export function MoblinControl({
  channelId,
  canEdit,
  broadcastActive,
  protectedPreview,
}: {
  channelId: string;
  canEdit: boolean;
  broadcastActive: boolean;
  protectedPreview: boolean;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [baseline, setBaseline] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [revision, setRevision] = useState(0);
  const dirtyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const dirty = !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/channels/${channelId}/moblin`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error('Unable to load Moblin setup.');
        const next: Data = await response.json();
        if (!disposed) {
          setData(next);
          setLoadError('');
          if (!dirtyRef.current) {
            setDraft(next.config);
            setBaseline(next.config);
            setRevision(next.revision);
          }
        }
      } catch {
        if (!disposed) setLoadError('Moblin status is unavailable. Retrying…');
      }
      if (!disposed) timer = setTimeout(load, 3000);
    }
    void load();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [channelId]);
  function change(patch: Partial<Config>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    dirtyRef.current = JSON.stringify(next) !== JSON.stringify(baseline);
    setDraft(next);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied.');
    } catch {
      toast.error('Unable to copy. Select and copy the value instead.');
    }
  }
  async function save(action: 'save' | 'rotate') {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/channels/${channelId}/moblin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, revision, ...(action === 'save' ? draft : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.password) {
        setPassword(result.password);
        setShowPassword(false);
      }
      const fresh = await fetch(`/api/channels/${channelId}/moblin`, { cache: 'no-store' });
      if (!fresh.ok)
        throw new Error('Saved, but unable to refresh. Reopen setup before saving again.');
      const next: Data = await fresh.json();
      dirtyRef.current = false;
      setData(next);
      setBaseline(next.config);
      setDraft(next.config);
      setRevision(next.revision);

      toast.success(
        action === 'rotate'
          ? 'New pairing password created. Update it in Moblin.'
          : 'Moblin setup saved.',
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to save.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  function close(next: boolean) {
    if (!next && dirty) {
      toast.error('Save or cancel your changes before closing.');
      return;
    }
    if (!next) {
      setPassword('');
      setShowPassword(false);
    }
    setOpen(next);
  }
  const connected = !!data?.connected && !loadError;
  const statusLabel = loadError
    ? 'Status unavailable'
    : !data
      ? 'Checking connection'
      : !data.allowed
        ? 'Disabled by policy'
        : !data.config.enabled
          ? 'Not paired'
          : connected
            ? 'Connected'
            : !data.gatewayReady
              ? 'Gateway offline'
              : 'Disconnected';
  const disconnected = !!data?.config.enabled && !connected && !loadError;
  const badge = (
    <span
      role="status"
      aria-label={`Moblin remote control: ${statusLabel}`}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold',
        connected
          ? 'border-primary/30 bg-primary/15 text-primary'
          : disconnected
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {connected ? (
        <Link2 size={16} />
      ) : disconnected ? (
        <Unlink size={16} />
      ) : (
        <CircleHelp size={16} />
      )}
      {statusLabel}
    </span>
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Smartphone size={17} />
              Moblin
            </p>
            {badge}
          </div>
          <p className="text-xs text-muted-foreground">
            {connected && data?.bitrateKbps !== null ? `${data?.bitrateKbps} kbps · ` : ''}
            {data?.config.syncBroadcast
              ? 'Phone controls destination start/stop'
              : 'Destination start/stop is controlled from this dashboard'}
          </p>
          <p className="text-xs text-muted-foreground">
            {broadcastActive
              ? 'Broadcast active · BRB protection on'
              : protectedPreview
                ? 'BRB-protected preview · Destinations are not broadcasting'
                : 'Not broadcasting · Moblin Go live can start a protected preview'}
          </p>
          {disconnected && data?.streaming === true && (
            <p className="text-xs text-muted-foreground">
              Remote control was lost. Preview and broadcast recovery stay active until Stop or the
              disconnect timeout.
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {canEdit ? 'Set up Moblin' : 'Moblin details'}
        </Button>
      </div>
      {data?.lastError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          Moblin: {data.lastError} After correcting this, stop and start streaming in Moblin to
          retry.
        </p>
      )}
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogTitle>Moblin remote control</DialogTitle>
          <div className="mt-2">{badge}</div>
          <DialogDescription>
            Pair this channel with Moblin. Video still uses your channel’s SRT/RTMP credentials.
            Start/stop here refers to your Twitch, YouTube and other enabled destinations.
          </DialogDescription>
          {(error || loadError) && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error || loadError}
            </p>
          )}
          {!data || !draft ? (
            <p className="py-6 text-sm text-muted-foreground">Loading setup…</p>
          ) : (
            <div className="space-y-5 pt-5">
              {!data.allowed && (
                <p className="text-xs text-muted-foreground">
                  Moblin pairing is disabled in instance administration. Existing setup can still be
                  disabled.
                </p>
              )}
              {!data.gatewayReady && (
                <p role="status" className="text-xs text-muted-foreground">
                  The Moblin gateway is not ready. Ask your instance administrator to start the
                  gateway and configure its public WebSocket URL in Admin → Moblin. Saving this form
                  does not deploy the gateway.
                </p>
              )}
              <div className="flex items-center justify-between gap-4 border-y border-border py-4">
                <Label htmlFor="moblin-enabled">Enable pairing for this channel</Label>
                <Switch
                  id="moblin-enabled"
                  checked={draft.enabled}
                  disabled={!canEdit || busy || (!data.allowed && !draft.enabled)}
                  onCheckedChange={(v) => change({ enabled: v })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="moblin-sync"
                    checked={draft.syncBroadcast}
                    disabled={!canEdit || busy || !data.allowed}
                    onCheckedChange={(v) => change({ syncBroadcast: v === true })}
                  />
                  <Label htmlFor="moblin-sync" className="leading-relaxed">
                    Let Moblin Go live / Stop start and end all enabled destinations
                  </Label>
                </div>
                <p className="pl-7 text-xs leading-relaxed text-muted-foreground">
                  Off by default. Pair while Moblin is stopped, then tap Go live on the phone.
                  Pairing an already-live phone never starts a broadcast. Losing Wi-Fi never sends
                  Stop. If you stop while offline, the stop is applied when the phone reconnects and
                  reports its state.
                </p>
              </div>
              <div className="space-y-3 border-y border-border py-4">
                <h3 className="text-sm font-medium">Low bitrate BRB</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  During a broadcast, sustained low upload bitrate switches program output to your
                  BRB scene. Recovery needs 20% above the threshold for a stable interval. The
                  channel’s disconnect timeout still applies when video disappears.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(
                    [
                      ['lowBitrateKbps', 'Threshold (kbps)', 0, 100000],
                      ['lowBitrateSeconds', 'BRB delay (seconds)', 2, 60],
                      ['recoverySeconds', 'Recovery (seconds)', 2, 60],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`moblin-${key}`}>{label}</Label>
                      <Input
                        id={`moblin-${key}`}
                        type="number"
                        min={min}
                        max={max}
                        value={draft[key]}
                        disabled={!canEdit || busy || !data.allowed}
                        onChange={(e) => change({ [key]: Number(e.target.value) })}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Set the threshold to 0 to disable bitrate-based BRB. Video-loss protection remains
                  active.
                </p>
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Connect Moblin</h3>
                <ol className="list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">
                  <li>
                    Add your destinations in this dashboard. For YouTube, enable auto-stop in
                    YouTube Studio.
                  </li>
                  <li>
                    Enable pairing above and save. Copy the generated password before closing this
                    dialog.
                  </li>
                  <li>
                    In Moblin, open <strong>Settings → Remote control</strong>. Set the password,
                    then enable <strong>Streamer</strong> and paste this connection URL. Turn off
                    remote chat/event forwarding unless you have a separate assistant for it.
                  </li>
                  <li>
                    Use this channel’s ingest URL for your Moblin stream. Wait for “Phone connected”
                    here. If destination control is checked, the phone’s next Go live / Stop will
                    control the broadcast. The web app’s Go live / End stream controls still work
                    independently.
                  </li>
                </ol>
                <Label htmlFor="moblin-url">Connection URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="moblin-url"
                    readOnly
                    value={data.endpoint}
                    className="min-w-0 font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!data.endpoint}
                    aria-label="Copy Moblin connection URL"
                    onClick={() => void copy(data.endpoint)}
                  >
                    <Copy size={14} />
                  </Button>
                </div>
                {data.endpointError && (
                  <p role="alert" className="text-xs text-destructive">
                    {data.endpointError}
                  </p>
                )}
                {password && (
                  <div className="space-y-2">
                    <Label htmlFor="moblin-password">New pairing password — shown only now</Label>
                    <div className="flex gap-2">
                      <Input
                        id="moblin-password"
                        type={showPassword ? 'text' : 'password'}
                        readOnly
                        value={password}
                        className="min-w-0 font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={
                          showPassword ? 'Hide pairing password' : 'Show pairing password'
                        }
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Copy pairing password"
                        onClick={() => void copy(password)}
                      >
                        <Copy size={14} />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Keep this password private. It authorizes the connected phone to this channel.
                      It is separate from your ingest key.
                    </p>
                  </div>
                )}
                {canEdit && data.revision > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || dirty || !data.allowed}
                    onClick={() => void save('rotate')}
                  >
                    Replace pairing password
                  </Button>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Saving changes or replacing the password disconnects the control connection.
                  Reconnect Moblin to apply them. This does not stop an existing broadcast.
                  Disabling pairing leaves ordinary streaming and manual controls available.
                </p>
              </div>
              {dirty && canEdit && (
                <div className="sticky bottom-0 flex justify-end gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      dirtyRef.current = false;
                      setDraft(data.config);
                      setBaseline(data.config);
                      setRevision(data.revision);
                    }}
                  >
                    Cancel changes
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void save('save')}>
                    {busy ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
