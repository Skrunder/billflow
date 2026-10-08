import { Cloud, LogIn, RefreshCw, Server, TriangleAlert, Unplug } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from '../ui/Toast';
import { Modal } from '../ui/Modal';
import { ErrorNotice, Field } from '../ui/misc';
import { Spinner } from '../ui/Spinner';
import type { ConnectPreview, SyncClient } from '../../sync/client';
import { useSyncClient, useSyncStatus } from '../../sync/context';
import { normalizeServerUrl } from '../../sync/url';
import { describeSync } from './SyncIndicator';

/**
 * Settings → Server sync (standalone app). Connect the phone to a
 * self-hosted BillFlow server, see how syncing is going, sync now,
 * sign in again, or disconnect. Rendered only when a sync client exists.
 */
export function ServerSyncSection() {
  const client = useSyncClient()!;
  const status = useSyncStatus()!;
  const toast = useToast();
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (location.hash === '#server-sync') ref.current?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const connected = status.phase !== 'disconnected';
  const { text, tone } = describeSync(status);
  const insecure = status.serverUrl?.startsWith('http://');

  const signInAgain = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.signInAgain(password);
      setPassword('');
      toast.success('Signed in again');
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section ref={ref} id="server-sync" className="card scroll-mt-24 p-4 sm:p-6">
      <h2 className="text-base font-semibold">Server sync</h2>
      <p className="mb-4 mt-0.5 text-sm text-slate-500 dark:text-slate-400">
        {connected
          ? 'This phone and your server share the same bills and events. Everything keeps working offline; changes sync when the server can be reached.'
          : 'Optional: connect to your self-hosted BillFlow server to share data with the web app and other phones. Everything keeps working offline either way.'}
      </p>

      {!connected && (
        <button type="button" className="btn-primary" onClick={() => setConnecting(true)}>
          <Server className="h-4 w-4" aria-hidden /> Connect to server
        </button>
      )}

      {connected && (
        <div className="space-y-3">
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-slate-500 dark:text-slate-400">Server</dt>
            <dd className="min-w-0 break-all">{status.serverUrl}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Account</dt>
            <dd className="min-w-0 break-all">{status.email}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Status</dt>
            <dd className={tone === 'bad' ? 'text-red-600 dark:text-red-400' : tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : ''} role="status">
              {text}
            </dd>
          </dl>
          {insecure && (
            <p className="hint">The connection isn&apos;t encrypted (http://). That&apos;s fine at home; use an https:// address to sync over the internet.</p>
          )}

          {status.phase === 'signed-out' ? (
            <form onSubmit={signInAgain} className="max-w-sm space-y-3">
              <ErrorNotice error={error} />
              <Field label={`Password for ${status.email}`}>
                {(id) => <input id={id} type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
              </Field>
              <button type="submit" className="btn-primary" disabled={busy || !password}>
                {busy ? <Spinner className="h-4 w-4 text-white" /> : <LogIn className="h-4 w-4" aria-hidden />} Sign in again
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void client.syncNow()} disabled={status.phase === 'syncing'}>
                <RefreshCw className={status.phase === 'syncing' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden /> Sync now
              </button>
            </div>
          )}
          <button type="button" className="btn-ghost text-red-600 dark:text-red-400" onClick={() => setConfirmDisconnect(true)}>
            <Unplug className="h-4 w-4" aria-hidden /> Disconnect
          </button>
        </div>
      )}

      {connecting && <ConnectDialog client={client} onClose={() => setConnecting(false)} />}

      <Modal open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Disconnect from the server?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Your bills and events stay on this phone, but changes stop syncing.
            {status.pending > 0 && <strong> {status.pending} change{status.pending === 1 ? '' : 's'} not yet uploaded will stay only on this phone.</strong>}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn-secondary" onClick={() => setConfirmDisconnect(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() =>
                void client.disconnect().then(() => {
                  setConfirmDisconnect(false);
                  toast.success('Disconnected');
                })
              }
            >
              Disconnect
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

type Step = { kind: 'form' } | { kind: 'preview'; preview: ConnectPreview } | { kind: 'working' };

function ConnectDialog({ client, onClose }: { client: SyncClient; onClose: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  let addressNote: string | null = null;
  try {
    if (address.trim() && normalizeServerUrl(address).insecure) addressNote = 'Plain http:// works on your home network only and isn’t encrypted.';
  } catch (err) {
    addressNote = (err as Error).message;
  }

  const cancel = () => {
    if (step.kind === 'working') return;
    if (step.kind === 'preview') void client.cancelConnect();
    onClose();
  };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStep({ kind: 'preview', preview: await client.prepareConnect(address, email, password) });
      setPassword('');
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (mode: 'combine' | 'replace') => {
    setStep({ kind: 'working' });
    try {
      await client.finishConnect(mode);
      const s = client.getStatus();
      if (s.phase === 'idle') toast.success('Connected and synced');
      else toast.info(describeSync(s).text);
      onClose();
    } catch (err) {
      setError(err as Error);
      setStep({ kind: 'form' });
    }
  };

  return (
    <Modal open onClose={cancel} title="Connect to your server" size="sm">
      {step.kind === 'form' && (
        <form onSubmit={signIn} className="space-y-4" noValidate>
          <ErrorNotice error={error} />
          <Field label="Server address" hint={addressNote ?? 'The address you open BillFlow at, e.g. 192.168.1.20:8080 or https://bills.example.com'}>
            {(id) => (
              <input id={id} className="input" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20:8080" required />
            )}
          </Field>
          <Field label="Email">
            {(id) => <input id={id} type="email" className="input" autoComplete="username" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />}
          </Field>
          <Field label="Password">
            {(id) => <input id={id} type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
          </Field>
          <div className="dialog-actions">
            <button type="button" className="btn-secondary" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !address.trim() || !email.trim() || !password}>
              {busy && <Spinner className="h-4 w-4 text-white" />} Continue
            </button>
          </div>
        </form>
      )}

      {step.kind === 'preview' && <Preview preview={step.preview} onChoose={(m) => void finish(m)} onCancel={cancel} />}

      {step.kind === 'working' && (
        <div className="flex items-center gap-3 py-6 text-sm" role="status">
          <Spinner className="h-5 w-5" /> Syncing… this can take a minute the first time.
        </div>
      )}
    </Modal>
  );
}

function Preview({ preview: p, onChoose, onCancel }: { preview: ConnectPreview; onChoose: (mode: 'combine' | 'replace') => void; onCancel: () => void }) {
  const count = (n: { bills: number; events: number }) => `${n.bills} bill${n.bills === 1 ? '' : 's'}, ${n.events} event${n.events === 1 ? '' : 's'}`;
  const phoneHasData = p.phone.bills + p.phone.events > 0;
  const serverHasData = p.server.bills + p.server.events > 0;
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm">
        <Cloud className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> Signed in to <span className="break-all font-medium">{p.serverUrl}</span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500 dark:text-slate-400">On this phone</dt>
        <dd>{count(p.phone)}</dd>
        <dt className="text-slate-500 dark:text-slate-400">On the server</dt>
        <dd>{count(p.server)}</dd>
      </dl>
      {phoneHasData && serverHasData && p.sameBills.length > 0 && (
        <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            On both: <strong>{p.sameBills.slice(0, 5).join(', ')}{p.sameBills.length > 5 ? '…' : ''}</strong>. Combining keeps both copies; you can delete the extras afterwards.
          </span>
        </p>
      )}
      <div className="space-y-2">
        {phoneHasData ? (
          <>
            <button type="button" className="btn-primary w-full" onClick={() => onChoose('combine')}>
              {serverHasData ? 'Combine both' : 'Upload this phone’s data'}
            </button>
            {serverHasData && (
              <button type="button" className="btn-secondary w-full" onClick={() => onChoose('replace')}>
                Use the server’s data (replaces what’s on this phone)
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn-primary w-full" onClick={() => onChoose('replace')}>
            Connect
          </button>
        )}
        <button type="button" className="btn-ghost w-full" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {phoneHasData && serverHasData && <p className="hint">Tip: make a backup first (Settings → Backup) if you might want this phone’s data as it is now.</p>}
    </div>
  );
}
