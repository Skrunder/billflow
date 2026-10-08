import clsx from 'clsx';
import { Cloud, CloudOff, CloudUpload, RefreshCw, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { timeAgo, useSyncStatus } from '../../sync/context';
import type { SyncStatus } from '../../sync/client';

/** One-line description of the sync state, shared by the header icon and Settings. */
export function describeSync(s: SyncStatus): { text: string; tone: 'ok' | 'busy' | 'warn' | 'bad' } {
  const waiting = s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : '';
  switch (s.phase) {
    case 'syncing':
      return { text: 'Syncing…', tone: 'busy' };
    case 'offline':
      return { text: `Can't reach the server${waiting ? ` · ${waiting}` : ''}`, tone: 'warn' };
    case 'signed-out':
      return { text: 'Signed out of the server: sign in again in Settings', tone: 'bad' };
    case 'error':
      return { text: `Sync problem: ${s.error ?? 'unknown error'}`, tone: 'bad' };
    default:
      return { text: waiting || `Synced ${timeAgo(s.lastSyncAt)}`, tone: waiting ? 'warn' : 'ok' };
  }
}

/** Header icon while connected to a server; links to the sync settings. */
export function SyncIndicator() {
  const status = useSyncStatus();
  if (!status || status.phase === 'disconnected') return null;
  const { text, tone } = describeSync(status);
  const Icon =
    status.phase === 'syncing' ? RefreshCw : status.phase === 'offline' ? CloudOff : tone === 'bad' ? TriangleAlert : status.pending ? CloudUpload : Cloud;
  return (
    <Link
      to="/settings#server-sync"
      className={clsx('icon-btn', tone === 'bad' && 'text-red-600 dark:text-red-400', tone === 'warn' && 'text-amber-600 dark:text-amber-400')}
      aria-label={text}
      title={text}
    >
      <Icon className={clsx('h-5 w-5', status.phase === 'syncing' && 'animate-spin')} aria-hidden />
    </Link>
  );
}
