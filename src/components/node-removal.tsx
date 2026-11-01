'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { Server } from '@/lib/types';
type RemovalPlan = {
  node: { id: string; name: string; host: string };
  managed: boolean;
  neverInstalled: boolean;
  canRemove: boolean;
  counts: { channels: number; destinations: number; events: number };
  installation: {
    id: string;
    mode: string;
    status: string;
    operation: string;
    step: string;
    error: string | null;
    logs: { at: string; message: string }[];
    sshHost: string;
    sshPort: number;
    sshUser: string;
    sshAuth: 'key' | 'password';
    fingerprint: string | null;
    hasCredentials: boolean;
    remoteCleaned: boolean;
  } | null;
};
const running = ['queued_remove', 'removing', 'remote_removed'];
export function NodeRemoval({
  node,
  onClose,
  onRemoved,
  onQueued,
}: {
  node: Server | null;
  onClose: () => void;
  onRemoved: () => void;
  onQueued: (jobId: string) => void;
}) {
  const [plan, setPlan] = useState<RemovalPlan | null>(null);
  const [error, setError] = useState('');
  const started = useRef(false);
  const finished = useRef(false);
  const refresh = useCallback(async () => {
    if (!node) return;
    const response = await fetch(`/api/nodes/${node.id}/removal`, { cache: 'no-store' });
    if (response.status === 404 && started.current && !finished.current) {
      finished.current = true;
      toast.success('Node permanently removed.', { id: plan?.installation?.id ?? node.id });
      onRemoved();
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (data.installation?.operation === 'remove') started.current = true;
    setPlan(data);
    setError('');
  }, [node, plan?.installation?.id, onRemoved]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh().catch((e) => setError(e.message)), 0);
    const timer = setInterval(() => void refresh().catch((e) => setError(e.message)), 2000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  return (
    <Dialog
      open={!!node}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle className="pr-8 text-xl font-medium break-words">
          Permanently remove {node?.name}?
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This uninstalls the node and deletes its saved data. Active broadcasts on this node will
          end. This action cannot be undone.
        </DialogDescription>
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        {plan ? (
          <RemovalForm
            plan={plan}
            refresh={refresh}
            onQueued={(jobId) => {
              started.current = true;
              onQueued(jobId);
            }}
            onRemoved={() => {
              finished.current = true;
              onRemoved();
            }}
          />
        ) : (
          !error && (
            <p className="mt-6 flex items-center gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Checking the node’s installation…
            </p>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
function RemovalForm({
  plan,
  refresh,
  onQueued,
  onRemoved,
}: {
  plan: RemovalPlan;
  refresh: () => Promise<void>;
  onQueued: (id: string) => void;
  onRemoved: () => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<'key' | 'password'>(plan.installation?.sshAuth ?? 'key');
  const [username, setUsername] = useState(plan.installation?.sshUser ?? 'root');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const job = plan.installation;
  const pending = !!job && running.includes(job.status);
  const ssh = job?.mode === 'ssh' && !plan.neverInstalled && !job.remoteCleaned;
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.logs]);
  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(`/api/nodes/${plan.node.id}/removal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation,
          permanent: accepted,
          ...(ssh ? { credentials: { username, method, password, privateKey, passphrase } } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.removed) {
        toast.success('Node and all its application data permanently removed.');
        onRemoved();
        return;
      }
      if (job) onQueued(job.id);
      toast.info('Permanent removal queued. You can close this window.', { id: job?.id });
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-xs leading-relaxed">
        <p className="flex items-center gap-2 font-medium text-destructive">
          <AlertTriangle size={16} />
          Permanent deletion
        </p>
        <ul className="mt-3 space-y-1 text-muted-foreground">
          <li>{plan.counts.channels} channels, their fallback scenes and ingest keys</li>
          <li>{plan.counts.destinations} destinations and stream keys</li>
          <li>{plan.counts.events} history events, previews and installation logs</li>
          {!plan.neverInstalled && (
            <li>
              Node containers, private volumes/networks, installation files, credentials, and
              machine identity on {plan.node.host}
            </li>
          )}
        </ul>
        <p className="mt-3 text-muted-foreground">
          Docker and unrelated applications are preserved.
        </p>
      </div>
      {!plan.managed ? (
        <p role="alert" className="text-sm text-destructive">
          This node was registered manually. Its remote installation ownership cannot be verified,
          so automatic permanent removal is unavailable.
        </p>
      ) : !plan.canRemove ? (
        <p role="alert" className="text-sm text-destructive">
          Removing a local installation requires an account in LOCAL_INSTALL_ADMIN_EMAILS and local
          node operations enabled.
        </p>
      ) : pending ? (
        <div role="status" className="space-y-2">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin text-destructive" />
            {job?.step}
          </p>
          <p className="text-xs text-muted-foreground">
            Removal continues in the background. Application records are deleted only after
            uninstall succeeds.
          </p>
        </div>
      ) : (
        <>
          {job?.error && job.operation === 'remove' && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              {job.error} Application data has been retained. Correct the connection and retry.
            </p>
          )}
          {job?.remoteCleaned && (
            <p className="text-xs text-muted-foreground">
              Remote cleanup already succeeded. Retry to finish deleting application records.
            </p>
          )}
          {ssh && (
            <fieldset disabled={busy} className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm">SSH access for uninstall</legend>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Connect to{' '}
                <span className="font-mono">
                  {job?.sshHost}:{job?.sshPort}
                </span>{' '}
                with root or passwordless sudo. The original host fingerprint is pinned. Setup
                credentials were cleared after installation.
              </p>
              <code className="block break-all text-[10px] text-muted-foreground">
                {job?.fingerprint}
              </code>
              <label className="block space-y-2 text-xs">
                <span>SSH username</span>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="block space-y-2 text-xs">
                <span>Authentication method</span>
                <select
                  aria-label="Authentication method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as 'key' | 'password')}
                >
                  <option value="key">Private SSH key</option>
                  <option value="password">Password</option>
                </select>
              </label>
              {method === 'key' ? (
                <>
                  <label className="block space-y-2 text-xs">
                    <span>Private key</span>
                    <textarea
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      className="min-h-24 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
                      autoComplete="off"
                      placeholder={
                        job?.hasCredentials
                          ? 'Saved securely; leave blank to reuse'
                          : '-----BEGIN OPENSSH PRIVATE KEY-----'
                      }
                    />
                  </label>
                  <label className="block space-y-2 text-xs">
                    <span>Key passphrase (optional)</span>
                    <Input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                </>
              ) : (
                <label className="block space-y-2 text-xs">
                  <span>SSH password</span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="off"
                    placeholder={job?.hasCredentials ? 'Saved securely; leave blank to reuse' : ''}
                  />
                </label>
              )}
            </fieldset>
          )}
          <label className="block space-y-2 text-sm">
            <span>
              Type <strong>{plan.node.name}</strong> to confirm
            </span>
            <Input
              aria-label="Node name confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label className="flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
            <input
              className="mt-0.5 accent-destructive"
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              disabled={busy}
            />
            I understand this permanently removes the node and all its data and ends its broadcasts.
          </label>
          <Button
            variant="destructive"
            className="w-full"
            disabled={
              busy ||
              !accepted ||
              confirmation !== plan.node.name ||
              (ssh && !job?.hasCredentials && !(method === 'key' ? privateKey : password))
            }
            onClick={() => void remove()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}{' '}
            {job?.operation === 'remove' ? 'Retry permanent removal' : 'Permanently remove node'}
          </Button>
        </>
      )}
      {job?.operation === 'remove' && !!job.logs.length && (
        <div>
          <p className="label mb-2">Removal progress</p>
          <div
            ref={logRef}
            role="log"
            aria-label="Removal progress"
            className="max-h-48 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[10px] leading-relaxed"
          >
            {job.logs.map((line, index) => (
              <p key={index} className="whitespace-pre-wrap break-words">
                <span className="mr-2 text-muted-foreground">
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
