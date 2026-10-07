import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createRemoteRepository } from './remote';
import type { DataRepository } from './repository';

const RepositoryContext = createContext<DataRepository | null>(null);

/**
 * Supplies the data source to every screen. The web app uses the server
 * (default); the Android build will pass its on-device repository instead.
 */
export function RepositoryProvider({ repository, children }: { repository?: DataRepository; children: ReactNode }) {
  const value = useMemo(() => repository ?? createRemoteRepository(), [repository]);
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): DataRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error('useRepository must be used inside RepositoryProvider');
  return repo;
}
