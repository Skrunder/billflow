import { useAuth } from '../auth/AuthProvider';
import { useRepository } from '../data/RepositoryProvider';
import { useOnline } from './useSettings';

/**
 * Whether changes can be made right now. With the server as data source that
 * needs a live session and a network connection; the on-device database is
 * always writable.
 */
export function useCanEdit(): boolean {
  const { status } = useAuth();
  const online = useOnline();
  const repo = useRepository();
  if (repo.kind === 'local') return true;
  return status === 'authenticated' && online;
}
