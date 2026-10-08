import { randomUuid, type PullResponse, type PushResponse, type User } from '@skr/core';
import type { LocalRepository } from '../data/local/engine';
import { normalizeServerUrl } from './url';

/**
 * Server sync for the standalone app (Android, or the standalone web build).
 *
 * The phone always works on its own database; this keeps it in step with a
 * self-hosted server when one is connected: local changes are pushed, then
 * the server's changes are pulled (docs/API.md, "Sync"). Sync problems never
 * block using the app; they only show in the status.
 *
 * Platform-neutral: HTTP and secret storage are passed in (native plugins on
 * Android, fetch/localStorage in a browser, supertest in tests).
 */

export interface HttpRequest {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  token?: string;
  body?: unknown;
  timeoutMs?: number;
}
/** Resolves with any HTTP status; rejects only when the server can't be reached. */
export type HttpTransport = (req: HttpRequest) => Promise<{ status: number; data: unknown }>;

export interface SecretStore {
  load(): Promise<string | null>;
  save(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export type SyncPhase = 'disconnected' | 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out';

export interface SyncStatus {
  phase: SyncPhase;
  serverUrl?: string;
  email?: string;
  lastSyncAt?: string;
  /** Local changes waiting to be uploaded. */
  pending: number;
  error?: string;
}

export interface ConnectPreview {
  serverUrl: string;
  email: string;
  phone: { bills: number; events: number };
  server: { bills: number; events: number };
  /** Bill names on both sides; "combine" would list them twice. */
  sameBills: string[];
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'auth' | 'server' | 'invalid',
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

const MAX_ROUNDS = 200;

/** First server version with phone sign-in and sync. */
export const MIN_SERVER_VERSION = '1.2.0';

/** True when a server version ("1.2.0", "1.10.3-beta") is at least MIN_SERVER_VERSION. */
export function supportsSync(version: string | undefined): boolean {
  const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  if (!version || !/^\d+\.\d+/.test(version)) return false;
  const [a, b] = [parts(version), parts(MIN_SERVER_VERSION)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}

function errorMessage(data: unknown, fallback: string) {
  const e = (data as { error?: { message?: string } } | null)?.error;
  return e?.message ?? fallback;
}

interface Session {
  serverUrl: string;
  email: string;
  deviceId: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  user: User;
}

export function createSyncClient(opts: {
  repo: LocalRepository;
  http: HttpTransport;
  secrets: SecretStore;
  deviceName?: string;
  /** Rows per upload request (default 500). */
  pushBatchSize?: number;
  /** Called after server data changed the local database (refresh the screens). */
  onDataChanged?: () => void;
}) {
  const { repo, http, secrets } = opts;
  let status: SyncStatus = { phase: 'disconnected', pending: 0 };
  const listeners = new Set<(s: SyncStatus) => void>();
  let access: { token: string; expiresAt: number } | null = null;
  let pendingConnect: Session | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function set(patch: Partial<SyncStatus>) {
    status = { ...status, ...patch };
    for (const fn of listeners) fn(status);
  }

  async function call<T>(req: HttpRequest): Promise<{ status: number; data: T }> {
    try {
      return (await http(req)) as { status: number; data: T };
    } catch {
      throw new SyncError('Can’t reach the server. Check the address and that this phone is on the right network.', 'network');
    }
  }

  const api = (serverUrl: string, path: string) => `${serverUrl}/api/v1${path}`;

  async function refreshStatus() {
    const state = await repo.sync.getState();
    set({ serverUrl: state.serverUrl, email: state.email, lastSyncAt: state.lastSyncAt, pending: state.deviceId ? await repo.sync.pendingCount() : 0 });
    return state;
  }

  /** A valid access token, refreshing (and saving the rotated refresh token) when needed. */
  async function accessToken(serverUrl: string): Promise<string> {
    if (access && access.expiresAt > Date.now() + 60_000) return access.token;
    const refreshToken = await secrets.load();
    if (!refreshToken) throw new SyncError('Signed out of the server', 'auth');
    const res = await call<{ accessToken: string; expiresIn: number; refreshToken: string }>({ method: 'POST', url: api(serverUrl, '/auth/native/refresh'), body: { refreshToken } });
    if (res.status === 401 || res.status === 403) throw new SyncError('The server signed this phone out. Sign in again.', 'auth');
    if (res.status !== 200) throw new SyncError(errorMessage(res.data, `Server error (${res.status})`), 'server');
    await secrets.save(res.data.refreshToken);
    access = { token: res.data.accessToken, expiresAt: Date.now() + res.data.expiresIn * 1000 };
    return access.token;
  }

  async function authed<T>(serverUrl: string, req: Omit<HttpRequest, 'token' | 'url'> & { path: string }): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await call<T>({ ...req, url: api(serverUrl, req.path), token: await accessToken(serverUrl) });
      if (res.status === 401 && attempt === 0) {
        access = null;
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new SyncError('The server signed this phone out. Sign in again.', 'auth');
      if (res.status < 200 || res.status >= 300) throw new SyncError(errorMessage(res.data, `Server error (${res.status})`), 'server');
      return res.data;
    }
    throw new SyncError('Signed out of the server', 'auth');
  }

  async function login(serverUrl: string, email: string, password: string, deviceName: string): Promise<Session> {
    const res = await call<{ accessToken: string; expiresIn: number; refreshToken: string; deviceId: string; user: User }>({
      method: 'POST',
      url: api(serverUrl, '/auth/native/login'),
      body: { email, password, deviceName },
    });
    if (res.status === 401) throw new SyncError('Wrong email or password.', 'auth');
    if (res.status !== 200) throw new SyncError(errorMessage(res.data, `Sign-in failed (${res.status})`), res.status >= 500 ? 'server' : 'auth');
    return {
      serverUrl,
      email,
      deviceId: res.data.deviceId,
      refreshToken: res.data.refreshToken,
      accessToken: res.data.accessToken,
      expiresAt: Date.now() + res.data.expiresIn * 1000,
      user: res.data.user,
    };
  }

  /** One full round: upload everything waiting, then download everything new. */
  async function round() {
    const state = await repo.sync.getState();
    if (!state.serverUrl || !state.deviceId) return;
    let changed = false;
    set({ phase: 'syncing', error: undefined });
    for (let i = 0; i < MAX_ROUNDS; i++) {
      const batch = await repo.sync.collectPush(opts.pushBatchSize ?? 500);
      if (!batch) break;
      const response = await authed<PushResponse>(state.serverUrl, {
        method: 'POST',
        path: '/sync/push',
        body: { deviceId: state.deviceId, batchId: randomUuid(), changes: batch.changes, deletes: batch.deletes },
        timeoutMs: 150_000,
      });
      await repo.sync.applyPushResult(batch, response);
      changed ||= response.adopt.length + response.remove.length + response.remapped.length > 0;
    }
    let cursor = state.cursor ?? '0';
    for (let i = 0; i < MAX_ROUNDS; i++) {
      const page = await authed<PullResponse>(state.serverUrl, { method: 'GET', path: `/sync/pull?since=${encodeURIComponent(cursor)}` });
      await repo.sync.applyPull(page);
      const c = page.changes;
      changed ||= Boolean(c.settings) || page.deletes.length > 0 || Object.values(c).some((v) => Array.isArray(v) && v.length > 0);
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    const lastSyncAt = new Date().toISOString();
    await repo.sync.setState({ lastSyncAt });
    set({ phase: 'idle', lastSyncAt, pending: await repo.sync.pendingCount() });
    if (changed) opts.onDataChanged?.();
  }

  async function runRound() {
    try {
      await round();
    } catch (err) {
      const e = err instanceof SyncError ? err : new SyncError((err as Error)?.message ?? 'Sync failed', 'server');
      if (e.kind === 'auth') access = null;
      set({
        phase: e.kind === 'network' ? 'offline' : e.kind === 'auth' ? 'signed-out' : 'error',
        error: e.message,
        pending: await repo.sync.pendingCount().catch(() => status.pending),
      });
    }
  }

  const client = {
    getStatus: () => status,
    subscribe(fn: (s: SyncStatus) => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },

    /** Reads the saved connection at startup. */
    async init() {
      const state = await refreshStatus();
      const token = await secrets.load();
      if (state.deviceId && token) set({ phase: 'idle' });
      else if (state.deviceId) set({ phase: 'signed-out', error: 'Sign in to the server again.' });
      else {
        // A sign-in left over from before a restore or a reset: forget it.
        if (token) await secrets.clear();
        set({ phase: 'disconnected' });
      }
    },

    /** Step 1 of connecting: sign in and look at both sides. Nothing is changed yet. */
    async prepareConnect(address: string, email: string, password: string, deviceName = opts.deviceName ?? 'Android phone'): Promise<ConnectPreview> {
      let serverUrl: string;
      try {
        serverUrl = normalizeServerUrl(address).url;
      } catch (err) {
        throw new SyncError((err as Error).message, 'invalid');
      }
      const health = await call<{ status?: string; version?: string }>({ method: 'GET', url: `${serverUrl}/api/health`, timeoutMs: 10_000 });
      if (health.status !== 200 || health.data?.status !== 'ok') throw new SyncError('No BillFlow server answered at that address.', 'invalid');
      // Older servers have no phone sign-in: they'd answer it as if the password were wrong.
      if (!supportsSync(health.data.version)) {
        throw new SyncError(
          `This server runs BillFlow ${health.data.version ?? '(unknown version)'}; phone sync needs ${MIN_SERVER_VERSION} or newer. Update the server, then connect again.`,
          'invalid',
        );
      }
      if (pendingConnect) await client.cancelConnect();
      const session = await login(serverUrl, email.trim(), password, deviceName);
      pendingConnect = session;
      access = { token: session.accessToken, expiresAt: session.expiresAt };

      const names = { bills: new Map<string, string>(), events: new Set<string>() };
      let cursor = '0';
      for (let i = 0; i < MAX_ROUNDS; i++) {
        const res = await call<PullResponse>({ method: 'GET', url: api(serverUrl, `/sync/pull?since=${cursor}`), token: session.accessToken });
        if (res.status !== 200) throw new SyncError(errorMessage(res.data, `Server error (${res.status})`), 'server');
        for (const b of res.data.changes.bills) names.bills.set(b.id, b.name);
        for (const e of res.data.changes.events) names.events.add(e.id);
        for (const d of res.data.deletes) if (d.entity === 'bills') names.bills.delete(d.id);
        cursor = res.data.cursor;
        if (!res.data.hasMore) break;
      }
      const local = await repo.sync.summary();
      const serverBillNames = new Set([...names.bills.values()].map((n) => n.toLowerCase()));
      return {
        serverUrl,
        email: session.email,
        phone: { bills: local.bills.length, events: local.events.length },
        server: { bills: names.bills.size, events: names.events.size },
        sameBills: [...new Set(local.bills.filter((n) => serverBillNames.has(n.toLowerCase())))],
      };
    },

    /** Step 2: 'combine' uploads this phone's data too; 'replace' swaps it for the server's. */
    async finishConnect(mode: 'combine' | 'replace') {
      const s = pendingConnect;
      if (!s) throw new SyncError('Sign in first.', 'invalid');
      pendingConnect = null;
      await secrets.save(s.refreshToken);
      if (mode === 'replace') await repo.sync.wipeForReplace();
      else await repo.sync.enqueueAll();
      await repo.sync.setState({ serverUrl: s.serverUrl, email: s.email, deviceId: s.deviceId, cursor: '0', lastSyncAt: null });
      await refreshStatus();
      await client.syncNow();
    },

    /** Gives up a sign-in from prepareConnect (signs that device out on the server). */
    async cancelConnect() {
      const s = pendingConnect;
      pendingConnect = null;
      access = null;
      if (s) await call({ method: 'POST', url: api(s.serverUrl, '/auth/native/logout'), body: { refreshToken: s.refreshToken } }).catch(() => undefined);
    },

    /** After the server signed this phone out: sign in again with the same account. Data and waiting changes are kept. */
    async signInAgain(password: string) {
      const state = await repo.sync.getState();
      if (!state.serverUrl || !state.email) throw new SyncError('Not connected', 'invalid');
      const s = await login(state.serverUrl, state.email, password, opts.deviceName ?? 'Android phone');
      await secrets.save(s.refreshToken);
      access = { token: s.accessToken, expiresAt: s.expiresAt };
      await repo.sync.setState({ deviceId: s.deviceId });
      set({ phase: 'idle', error: undefined });
      await client.syncNow();
    },

    /** Uploads and downloads now. Never throws; problems end up in the status. */
    async syncNow(): Promise<void> {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        do {
          again = false;
          await runRound();
        } while (again);
      })().finally(() => {
        running = null;
      });
      return running;
    },

    /** Syncs after a short pause (coalesces bursts of changes). */
    syncSoon(delayMs = 3000) {
      if (status.phase === 'disconnected' || status.phase === 'signed-out') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void client.syncNow();
      }, delayMs);
    },

    /** Stop syncing with the server. Everything stays on the phone. */
    async disconnect() {
      const state = await repo.sync.getState();
      const token = await secrets.load();
      if (state.serverUrl && token) {
        await call({ method: 'POST', url: api(state.serverUrl, '/auth/native/logout'), body: { refreshToken: token } }).catch(() => undefined);
      }
      await secrets.clear();
      await repo.sync.clear();
      access = null;
      set({ phase: 'disconnected', serverUrl: undefined, email: undefined, lastSyncAt: undefined, pending: 0, error: undefined });
    },

    /** Local data changed: update the waiting count and sync shortly. */
    async localChanged() {
      if (status.phase === 'disconnected') return;
      const pending = await repo.sync.pendingCount();
      set({ pending });
      if (pending > 0) client.syncSoon();
    },
  };
  return client;
}

export type SyncClient = ReturnType<typeof createSyncClient>;
