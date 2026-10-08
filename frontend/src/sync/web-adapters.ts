import type { HttpTransport, SecretStore } from './client';

/**
 * Sync adapters for the standalone web build in a browser (development and
 * testing). The Android app registers native ones (native/android.ts): its
 * WebView can't call a plain-http server from its https://localhost page.
 */

export const fetchTransport: HttpTransport = async ({ method, url, token, body, timeoutMs = 30_000 }) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      signal: abort.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
};

const KEY = 'skr-sync-refresh';

export const localStorageSecrets: SecretStore = {
  async load() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  async save(token) {
    localStorage.setItem(KEY, token);
  },
  async clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
