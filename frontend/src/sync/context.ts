import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SyncClient, SyncStatus } from './client';

/**
 * Sync client for the standalone app, provided by SyncProvider (loaded only in
 * the standalone build). Elsewhere these hooks return null, so screens can
 * use them without pulling in any sync code.
 */
export const SyncContext = createContext<SyncClient | null>(null);

export const useSyncClient = () => useContext(SyncContext);

const noSubscribe = () => () => {};
const noStatus = () => null;

export function useSyncStatus(): SyncStatus | null {
  const client = useSyncClient();
  return useSyncExternalStore(client ? client.subscribe : noSubscribe, client ? client.getStatus : noStatus);
}

/** "just now", "5 min ago", "3 h ago", or the date. */
export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}
