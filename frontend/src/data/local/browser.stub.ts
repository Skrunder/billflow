import type { LocalRepository } from './engine';

/**
 * Stand-in for ./browser in the normal (server-backed) web build, so the
 * SQLite engine and its WebAssembly file are never bundled there.
 * See the alias in vite.config.ts.
 */
export async function openBrowserLocalRepository(): Promise<LocalRepository> {
  throw new Error('This build talks to a server; the on-device database is only in the standalone build.');
}
