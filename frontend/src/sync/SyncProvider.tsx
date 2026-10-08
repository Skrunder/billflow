import { useEffect, useMemo, type ReactNode } from 'react';
import type { LocalRepository } from '../data/local/engine';
import { getSyncAdapters } from '../native/device';
import { queryClient } from '../queryClient';
import { createSyncClient } from './client';
import { SyncContext } from './context';
import { fetchTransport, localStorageSecrets } from './web-adapters';

const EVERY_FEW_MINUTES = 5 * 60_000;

/**
 * Creates the sync client for the standalone app and keeps it running:
 * at start, shortly after local changes, when the app comes back to the
 * foreground or the network returns, and every few minutes while open.
 */
export function SyncProvider({ repo, children }: { repo: LocalRepository; children: ReactNode }) {
  const client = useMemo(() => {
    const native = getSyncAdapters();
    return createSyncClient({
      repo,
      http: native?.http ?? fetchTransport,
      secrets: native?.secrets ?? localStorageSecrets,
      deviceName: native?.deviceName ?? 'Browser',
      onDataChanged: () => void queryClient.invalidateQueries(),
    });
  }, [repo]);

  useEffect(() => {
    void client.init().then(() => client.syncNow());
    const unsubscribe = repo.subscribeChanges(() => void client.localChanged());
    const onVisible = () => document.visibilityState === 'visible' && client.syncSoon(500);
    const onOnline = () => client.syncSoon(500);
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('online', onOnline);
    const timer = setInterval(() => client.syncSoon(0), EVERY_FEW_MINUTES);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [client, repo]);

  return <SyncContext.Provider value={client}>{children}</SyncContext.Provider>;
}
