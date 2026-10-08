import type { AuthResponse } from '@skr/core';

/**
 * Fetch wrapper for the REST API.
 *
 * - The short-lived access token lives only in memory (never in storage).
 * - The refresh token is an httpOnly, SameSite=Strict cookie scoped to the
 *   auth endpoints; refreshing requires the double-submit CSRF header.
 * - A 401 triggers one silent refresh (shared by concurrent requests) and a
 *   retry. If refreshing fails the app is notified via onAuthLost.
 */

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown when the server could not be reached at all (offline, DNS, …). */
export class NetworkError extends Error {
  constructor() {
    super('Unable to reach the server. Check your connection.');
    this.name = 'NetworkError';
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse | null> | null = null;
let onAuthLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setAuthLostHandler(fn: () => void) {
  onAuthLost = fn;
}

function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    const e = body?.error ?? {};
    return new ApiError(res.status, e.code ?? 'ERROR', e.message ?? res.statusText, e.details);
  } catch {
    return new ApiError(res.status, 'ERROR', res.statusText || 'Request failed');
  }
}

async function doFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { credentials: 'same-origin', ...init });
  } catch {
    throw new NetworkError();
  }
}

async function performRefresh(): Promise<AuthResponse | null> {
  const csrf = readCookie('skr_csrf');
  if (!csrf) return null;
  // A refresh racing another tab, or retried after a lost response, gets a
  // fresh token too (see consumeRefreshToken on the server).
  const res = await doFetch(`${API_BASE}/auth/refresh`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } });
  if (!res.ok) return null;
  const data = (await res.json()) as AuthResponse;
  accessToken = data.accessToken;
  return data;
}

/** Single-flight refresh. Resolves to null when there is no valid session. */
export function refreshSession(): Promise<AuthResponse | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Set false for public endpoints (login, register, …). */
  auth?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true } = opts;
  let url = `${API_BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const send = () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return doFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };

  let res = await send();
  if (res.status === 401 && auth) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      accessToken = null;
      onAuthLost?.();
      throw await toApiError(res);
    }
    res = await send();
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? await res.json() : await res.text()) as T;
}

/** Logout uses the cookie + CSRF header, not the access token. */
export async function logoutRequest(): Promise<void> {
  const csrf = readCookie('skr_csrf');
  try {
    await doFetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: csrf ? { 'X-CSRF-Token': csrf } : {} });
  } finally {
    accessToken = null;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.details?.length) return err.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('\n');
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
