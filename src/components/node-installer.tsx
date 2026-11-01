'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useId,
  isValidElement,
  cloneElement,
} from 'react';
import { toast } from 'sonner';
import {
  Check,
  ChevronRight,
  Download,
  KeyRound,
  Loader2,
  Monitor,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
export type InstallConfig = {
  name: string;
  host: string;
  region: string;
  controlUrl: string;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshAuth?: 'key' | 'password';
};
export type Installation = {
  id: string;
  nodeId: string;
  startedAt: string | null;
  mode: 'local' | 'ssh';
  status: string;
  step: string;
  config: InstallConfig;
  hasCredentials: boolean;
  fingerprint: string | null;
  error: string | null;
  logs: { at: string; message: string }[];
};
type InstallData = {
  jobs: Installation[];
  localInstalled: boolean;
  localNodeId: string | null;
  localEnabled: boolean;
  installerOnline: boolean;
  defaultControlUrl: string;
};
export function useNodeInstallations(enabled: boolean) {
  const [data, setData] = useState<InstallData>({
    jobs: [],
    localInstalled: false,
    localNodeId: null,
    localEnabled: false,
    installerOnline: false,
    defaultControlUrl: '',
  });
  const previous = useRef<Map<string, string>>(new Map());
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const res = await fetch('/api/nodes/installations', { cache: 'no-store' });
    if (!res.ok) return;
    const next: InstallData = await res.json();
    for (const job of next.jobs) {
      const prior = previous.current.get(job.id);
      if (prior && prior !== job.status) {
        if (job.status === 'complete')
          toast.success(`${job.config.name} is connected and ready.`, { id: job.id });
        else if (job.status === 'failed')
          toast.error(`Node installation needs attention.`, {
            id: job.id,
            description: job.error ?? undefined,
            duration: 8000,
          });
        else if (job.status === 'awaiting_trust')
          toast.info('Verify the SSH host fingerprint to continue.', { id: job.id });
      }
      previous.current.set(job.id, job.status);
    }
    setData(next);
  }, [enabled]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh().catch(() => {}), 0);
    const timer = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  return { ...data, refresh };
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="block space-y-2 text-sm">
      <label htmlFor={id} className="block">
        {label}
      </label>
      {isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
        ? cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })
        : children}
      {hint && (
        <span id={`${id}-hint`} className="block text-xs text-muted-foreground leading-relaxed">
          {hint}
        </span>
      )}
    </div>
  );
}
export function NodeInstaller({
  open,
  onClose,
  selectedId,
  onSelect,
  data,
  onReady,
}: {
  open: boolean;
  onClose: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  data: ReturnType<typeof useNodeInstallations>;
  onReady: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const job = data.jobs.find((j) => j.id === selectedId);
  async function create(mode: 'local' | 'ssh') {
    setBusy(true);
    try {
      const response = await fetch('/api/nodes/installations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      await data.refresh();
      onSelect(next.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (saveRef.current && !(await saveRef.current())) return;
    onClose();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) void close();
      }}
    >
      <DialogContent>
        <DialogTitle className="text-xl font-medium pr-8 break-words">
          {job ? `Set up ${job.config.name || 'your node'}` : 'Add a node'}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {job
            ? 'You can close this window at any time. Saved settings and installation progress stay here.'
            : 'Install the streaming stack on this server or connect a remote Linux machine over SSH.'}
        </DialogDescription>
        {!data.installerOnline && (
          <div
            role="status"
            className="mt-5 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-200"
          >
            Installer service is offline. Start it on the app server with{' '}
            <code>npm run installer</code>, or <code>docker compose up -d installer</code>. Queued
            work will start when it connects.
          </div>
        )}
        {job ? (
          <InstallationSteps
            key={job.id}
            job={job}
            canEdit={job.mode !== 'local' || data.localEnabled}
            refresh={data.refresh}
            saveRef={saveRef}
            onReady={() => {
              onClose();
              onReady();
            }}
            onDiscard={() => {
              onSelect(null);
              void data.refresh();
            }}
          />
        ) : (
          <div className="mt-6 space-y-3">
            <button
              className="w-full rounded-xl border border-border p-5 text-left hover:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={busy || data.localInstalled || !data.localEnabled}
              onClick={() => void create('local')}
            >
              <span className="flex items-center gap-3 font-medium">
                <Monitor size={20} className="text-primary" />
                Install locally
                <ChevronRight size={16} className="ml-auto" />
              </span>
              <span className="block mt-2 text-xs text-muted-foreground leading-relaxed">
                Use the current app server’s Docker host. Only one managed node can be installed per
                server.
              </span>
            </button>
            {data.localInstalled ? (
              <p className="px-2 text-xs text-muted-foreground">
                A local node is already registered.
                {data.localNodeId && (
                  <button
                    className="ml-1 text-primary underline"
                    onClick={() =>
                      onSelect(data.jobs.find((j) => j.nodeId === data.localNodeId)?.id ?? null)
                    }
                  >
                    Open its setup
                  </button>
                )}
              </p>
            ) : (
              !data.localEnabled && (
                <p className="px-2 text-xs text-muted-foreground">
                  Set <code>ENABLE_LOCAL_INSTALL=1</code> on the app and installer to enable local
                  installation.
                </p>
              )
            )}
            <button
              className="w-full rounded-xl border border-border p-5 text-left hover:border-primary/50 disabled:opacity-40"
              disabled={busy}
              onClick={() => void create('ssh')}
            >
              <span className="flex items-center gap-3 font-medium">
                <Server size={20} className="text-primary" />
                Install on a remote server
                <ChevronRight size={16} className="ml-auto" />
              </span>
              <span className="block mt-2 text-xs text-muted-foreground leading-relaxed">
                Connect with SSH. We install Docker when needed, deploy the media services, and
                connect the node automatically.
              </span>
            </button>
          </div>
        )}
        {job && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={async () => {
              if (saveRef.current && !(await saveRef.current())) return;
              onSelect(null);
            }}
          >
            Set up another node
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
function InstallationSteps({
  job,
  canEdit,
  refresh,
  saveRef,
  onReady,
  onDiscard,
}: {
  job: Installation;
  canEdit: boolean;
  refresh: () => Promise<void>;
  saveRef: React.RefObject<(() => Promise<boolean>) | null>;
  onReady: () => void;
  onDiscard: () => void;
}) {
  const [config, setConfig] = useState(job.config);
  const [credentials, setCredentials] = useState<{
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }>({});
  const authType = config.sshAuth ?? 'key';
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const lastSaved = useRef(JSON.stringify({ config: job.config, credentials: {} }));
  const editable = canEdit && ['draft', 'failed', 'awaiting_trust'].includes(job.status);
  const checkingLocal =
    job.mode === 'local' &&
    ['queued_install', 'installing'].includes(job.status) &&
    !/^(Building|Unpacking|Starting|Waiting)/.test(job.step);
  const step =
    job.status === 'complete'
      ? 3
      : job.status === 'awaiting_trust' || ['checking', 'queued_check'].includes(job.status)
        ? 1
        : checkingLocal
          ? 1
          : ['installing', 'queued_install', 'waiting'].includes(job.status)
            ? 2
            : 0;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job.logs]);
  const save = useCallback(async () => {
    if (!editable) return true;
    const snapshot = { ...config };
    const secret = { ...credentials };
    const serialized = JSON.stringify({ config: snapshot, credentials: secret });
    if (serialized === lastSaved.current) return queue.current;
    const operation = async () => {
      try {
        const response = await fetch(`/api/nodes/installations/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', config: snapshot, credentials: secret }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        lastSaved.current = serialized;
        return true;
      } catch (e) {
        toast.error((e as Error).message);
        return false;
      }
    };
    queue.current = queue.current.then(operation, operation);
    return queue.current;
  }, [editable, config, credentials, job.id]);
  useEffect(() => {
    saveRef.current = save;
    return () => {
      saveRef.current = null;
    };
  }, [save, saveRef]);
  useEffect(() => {
    if (!editable) return;
    const timer = setTimeout(() => void save(), 700);
    return () => clearTimeout(timer);
  }, [save, editable]);
  function field(key: keyof InstallConfig, value: string | number) {
    setConfig((c) => ({ ...c, [key]: value }));
  }
  async function action(action: string) {
    setBusy(true);
    try {
      if (action !== 'discard' && !(await save())) return;
      const res = await fetch(`/api/nodes/installations/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      if (action === 'discard') {
        toast.success('Draft removed.');
        onDiscard();
        return;
      }
      toast.info(
        action === 'edit'
          ? 'Connection settings reopened.'
          : action === 'trust' || job.mode === 'local'
            ? 'Installation queued. It will continue if you close this window.'
            : 'Checking the SSH host key…',
      );
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-6">
      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Installation steps">
        {['Configure', job.mode === 'local' ? 'Checks' : 'Verify', 'Install', 'Ready'].map(
          (name, index) => (
            <li
              key={name}
              className={cn(
                'min-w-0 border-t-2 pt-2 text-[9px] sm:text-[10px] uppercase tracking-wider',
                index <= step
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground',
              )}
            >
              <span className="mb-1 block text-xs">{index + 1}.</span>
              {name}
            </li>
          ),
        )}
      </ol>
      {step === 0 && (
        <fieldset disabled={busy || !canEdit} className="space-y-4">
          {!canEdit && (
            <p className="text-xs text-amber-200">
              Local setup requires an administrator listed in LOCAL_INSTALL_ADMIN_EMAILS on the app
              server.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Node name">
              <Input
                value={config.name}
                onChange={(e) => field('name', e.target.value)}
                maxLength={80}
              />
            </Field>
            <Field label="Region">
              <Input
                value={config.region}
                onChange={(e) => field('region', e.target.value)}
                maxLength={60}
              />
            </Field>
          </div>
          <Field
            label="Public hostname or IP"
            hint="Your encoder connects to this address. Open TCP 1935, UDP 8890, and UDP 5000 on its firewall."
          >
            <Input
              value={config.host}
              onChange={(e) => field('host', e.target.value)}
              placeholder="stream.example.com"
            />
          </Field>
          <Field
            label="Control panel URL"
            hint={
              job.mode === 'local'
                ? 'The node calls this app URL. Localhost is mapped to the Docker host automatically.'
                : 'Use your publicly reachable HTTPS app origin. The node needs outbound HTTPS; no database or inbound management port is required.'
            }
          >
            <Input
              value={config.controlUrl}
              onChange={(e) => field('controlUrl', e.target.value)}
              placeholder="https://irl.example.com"
            />
          </Field>
          {job.mode === 'ssh' && (
            <>
              <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                Use a Debian/Ubuntu Linux host with internet access and root or passwordless sudo.
                Docker Engine and Compose are installed automatically when missing. Existing Docker
                installs are reused. Only one IRL node is allowed per Docker host.
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <Field label="SSH host">
                  <Input
                    value={config.sshHost}
                    onChange={(e) => field('sshHost', e.target.value)}
                    placeholder="203.0.113.10"
                  />
                </Field>
                <Field label="SSH port">
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={config.sshPort}
                    onChange={(e) => field('sshPort', Number(e.target.value))}
                  />
                </Field>
              </div>
              <Field label="SSH username">
                <Input value={config.sshUser} onChange={(e) => field('sshUser', e.target.value)} />
              </Field>
              <Field label="Authentication">
                <select
                  value={authType}
                  onChange={(e) => {
                    field('sshAuth', e.target.value);
                    setCredentials({});
                  }}
                >
                  <option value="key">Private SSH key</option>
                  <option value="password">Password</option>
                </select>
              </Field>
              {authType === 'key' ? (
                <>
                  <Field
                    label="Private key"
                    hint={
                      job.hasCredentials
                        ? 'Credentials saved encrypted. Leave blank to keep them.'
                        : 'Encrypted while setup is pending and deleted from the app after installation succeeds.'
                    }
                  >
                    <textarea
                      className="w-full min-h-28 rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary"
                      value={credentials.privateKey ?? ''}
                      onChange={(e) =>
                        setCredentials((c) => ({ ...c, privateKey: e.target.value }))
                      }
                      placeholder={
                        job.hasCredentials
                          ? 'Saved securely'
                          : '-----BEGIN OPENSSH PRIVATE KEY-----'
                      }
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Key passphrase (optional)">
                    <Input
                      type="password"
                      value={credentials.passphrase ?? ''}
                      onChange={(e) =>
                        setCredentials((c) => ({ ...c, passphrase: e.target.value }))
                      }
                      autoComplete="off"
                    />
                  </Field>
                </>
              ) : (
                <Field
                  label="SSH password"
                  hint={
                    job.hasCredentials
                      ? 'Saved encrypted. Leave blank to keep it.'
                      : 'Deleted from the app once installation succeeds.'
                  }
                >
                  <Input
                    type="password"
                    value={credentials.password ?? ''}
                    onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
                    autoComplete="off"
                    placeholder={job.hasCredentials ? 'Saved securely' : ''}
                  />
                </Field>
              )}
            </>
          )}
          {job.error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              {job.error}
            </p>
          )}
          <div className="flex justify-between gap-3 pt-2">
            <Button
              variant="ghost"
              disabled={busy || !!job.startedAt}
              onClick={() => void action('discard')}
            >
              Discard draft
            </Button>
            <Button disabled={busy} onClick={() => void action('check')}>
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : job.mode === 'local' ? (
                <Download size={14} />
              ) : (
                <KeyRound size={14} />
              )}{' '}
              {job.mode === 'local'
                ? 'Install locally'
                : job.status === 'failed'
                  ? 'Retry SSH setup'
                  : 'Check SSH connection'}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Changes save automatically. Closing also saves your current settings.
          </p>
        </fieldset>
      )}
      {step === 1 && (
        <div className="space-y-4">
          {job.status === 'awaiting_trust' ? (
            <>
              <ShieldCheck className="text-primary" />
              <h3 className="font-medium">Verify this machine’s identity</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Compare this SSH fingerprint with your server console or hosting provider before
                installing.
              </p>
              <code className="block break-all rounded-lg border border-border bg-background p-3 text-xs select-all">
                {job.fingerprint}
              </code>
              <p className="text-xs text-muted-foreground">
                On the remote server, list fingerprints with:
              </p>
              <code className="block break-all rounded-lg bg-background p-3 text-[11px] select-all">
                {'for key in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$key" -E sha256; done'}
              </code>
              <Button disabled={busy} className="w-full" onClick={() => void action('trust')}>
                <ShieldCheck size={14} />
                Trust host & install
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                className="w-full"
                onClick={() => void action('edit')}
              >
                Back to connection settings
              </Button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <Loader2 size={16} className="animate-spin text-primary" />
              {job.step}
            </p>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <p role="status" className="flex gap-2 items-center text-sm">
            <Loader2 size={17} className="animate-spin text-primary" />
            {job.step === 'install' ? 'Waiting for the installer…' : job.step}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            First-time builds can take several minutes. Keep the machine online. You can close this
            modal and resume from Nodes.
          </p>
        </div>
      )}
      {step === 3 && (
        <div className="text-center space-y-4 py-4">
          <Check size={36} className="mx-auto text-primary" />
          <h3 className="text-xl">Your node is ready.</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            SRTLA, SRT, and RTMP ingest are installed. Create a channel and select this node to
            start broadcasting.
          </p>
          <Button onClick={onReady}>
            Create a channel
            <ChevronRight size={15} />
          </Button>
        </div>
      )}
      {job.logs.length > 0 && (
        <div className="mt-5">
          <p className="label mb-2 flex gap-2 items-center">
            <Terminal size={13} />
            Installation log
          </p>
          <div
            ref={logRef}
            role="log"
            aria-label="Installation log"
            className="max-h-52 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[10px] leading-relaxed"
          >
            {job.logs.map((line, index) => (
              <p className="break-words whitespace-pre-wrap" key={index}>
                <span className="text-muted-foreground mr-2">
                  {new Date(line.at).toLocaleTimeString()}
                </span>
                {line.message}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
