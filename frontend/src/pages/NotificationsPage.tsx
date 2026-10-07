import clsx from 'clsx';
import { BellOff, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMarkNotifications, useNotifications } from '../api/hooks';
import { EmptyState, PageHeader } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useCanEdit } from '../hooks/useCanEdit';
import { useSettings } from '../hooks/useSettings';
import { formatInstant } from '../lib/format';

export function NotificationsPage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const { data = [], isLoading } = useNotifications();
  const mark = useMarkNotifications();
  const unread = data.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : 'All caught up'}
        actions={
          unread > 0 &&
          canEdit && (
            <button className="btn-secondary" onClick={() => mark.mutate(undefined)} disabled={mark.isPending}>
              <CheckCheck className="h-4 w-4" aria-hidden /> Mark all read
            </button>
          )
        }
      />
      <div className="card overflow-hidden">
        {isLoading ? (
          <LoadingBlock />
        ) : data.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.map((n) => (
              <li key={n.id}>
                <button
                  className={clsx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50', !n.readAt && 'bg-brand-50/60 dark:bg-brand-500/5')}
                  onClick={() => {
                    if (!n.readAt && canEdit) mark.mutate(n.id);
                    if (n.url) navigate(n.url);
                  }}
                >
                  <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-label={n.readAt ? undefined : 'Unread'} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{n.body}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{formatInstant(n.scheduledFor, settings.timezone, settings.locale, settings.timeFormat)}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={BellOff} title="No notifications yet">
            Reminders for bills and events will show up here.
          </EmptyState>
        )}
      </div>
    </>
  );
}
