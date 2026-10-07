import { useAuth } from '../auth/AuthProvider';
import { useOnline } from './useSettings';

/** Mutations are only possible with a live session and network connection. */
export function useCanEdit(): boolean {
  const { status } = useAuth();
  const online = useOnline();
  return status === 'authenticated' && online;
}
