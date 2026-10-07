import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';

/**
 * Queries are persisted to localStorage so previously viewed data (dashboard,
 * calendar, bills…) is available offline. The cache is wiped on sign-out and
 * whenever a different user signs in on the same device.
 */
export const CACHE_KEY = 'skr-query-cache';
export const CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: CACHE_MAX_AGE,
      retry: (count, err) => {
        const status = (err as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false;
        return count < 2;
      },
      // Serve cached data immediately, even when offline.
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: true,
    },
    mutations: { networkMode: 'online' },
  },
});

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export const persister = createSyncStoragePersister({ storage: safeStorage(), key: CACHE_KEY, throttleTime: 2000 });

export function clearPersistedCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
