import { Archive, ArchiveRestore, CalendarHeart, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useEvent, useEventOccurrences, useEventTemplateAction } from '../api/hooks';
import { EventOccurrenceDialog } from '../components/events/EventOccurrenceDialog';
import { EventOccurrenceRow } from '../components/events/EventOccurrenceRow';
import { HistoryList } from '../components/shared/HistoryList';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CategoryDot, EmptyState, ErrorNotice, PageHeader, Segmented } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { useCanEdit } from '../hooks/useCanEdit';
import { useSettings } from '../hooks/useSettings';
import { describeOffset, describeRecurrence, formatClock, formatDate, todayIn } from '../lib/format';

export function EventDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useSettings();
  const canEdit = useCanEdit();
  const { data: event, isLoading, error } = useEvent(id);
  const [view, setView] = useState<'occurrences' | 'history'>('occurrences');
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const action = useEventTemplateAction();
  const today = todayIn(settings.timezone);
  const occurrences = useEventOccurrences(
    scope === 'upcoming' ? { eventId: id, start: today, limit: 60 } : { eventId: id, end: today, order: 'desc', limit: 200 },
    Boolean(id),
  );
  const openId = params.get('occurrence');
  const setOpenId = (o: string | null) => setParams(o ? { occurrence: o } : {}, { replace: true });

  if (isLoading) return <LoadingBlock />;
  if (!event) return <ErrorNotice error={error ?? new Error('Event not found')} />;

  const runAction = (a: 'archive' | 'unarchive' | 'delete') =>
    action.mutate(
      { id: event.id, action: a },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success(a === 'delete' ? 'Event deleted' : a === 'archive' ? 'Series ended' : 'Series resumed');
          if (a === 'delete') navigate('/events?tab=all', { replace: true });
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <>
      <PageHeader
        title={event.title}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <CategoryDot color={event.category?.color} /> {event.category?.name ?? 'Uncategorised'}
            {event.isArchived && ' · Series ended'}
          </span>
        }
        actions={
          canEdit && (
            <>
              <Link to={`/events/${event.id}/edit`} className="btn-secondary">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </Link>
              {event.isRecurring &&
                (event.isArchived ? (
                  <button className="btn-secondary" onClick={() => runAction('unarchive')}>
                    <ArchiveRestore className="h-4 w-4" aria-hidden /> Resume
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={() => setConfirm('archive')}>
                    <Archive className="h-4 w-4" aria-hidden /> End series
                  </button>
                ))}
              <button className="btn-secondary text-red-600" onClick={() => setConfirm('delete')}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </button>
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="card p-4">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Schedule</dt>
              <dd>{describeRecurrence(event.recurrence, event.startDate)}</dd>
              {event.recurrence?.rrule && <dd className="mt-0.5 font-mono text-[11px] text-slate-400">{event.recurrence.rrule}</dd>}
            </div>
            <div>
              <dt className="text-xs text-slate-500">{event.isRecurring ? 'Starts' : 'Date'}</dt>
              <dd>{formatDate(event.startDate, settings.locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Time</dt>
              <dd>
                {event.allDay
                  ? 'All day'
                  : `${formatClock(event.startTime, settings.timeFormat)}${event.endTime ? ` – ${formatClock(event.endTime, settings.timeFormat)}` : ''}`}
              </dd>
            </div>
            {event.location && (
              <div>
                <dt className="text-xs text-slate-500">Location</dt>
                <dd>{event.location}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-slate-500">Reminders</dt>
              <dd>{event.reminderOffsets.length ? event.reminderOffsets.map(describeOffset).join(', ') : 'None'}</dd>
            </div>
            {event.description && (
              <div>
                <dt className="text-xs text-slate-500">Description</dt>
                <dd>{event.description}</dd>
              </div>
            )}
            {event.notes && (
              <div>
                <dt className="text-xs text-slate-500">Notes</dt>
                <dd className="whitespace-pre-line">{event.notes}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="card overflow-hidden lg:col-span-2">
          <div className="card-header flex-wrap">
            <Segmented
              label="Section"
              value={view}
              onChange={setView}
              options={[
                { value: 'occurrences', label: 'Occurrences' },
                { value: 'history', label: 'Series history' },
              ]}
            />
            {view === 'occurrences' && (
              <Segmented
                label="Range"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'upcoming', label: 'Upcoming' },
                  { value: 'past', label: 'Past' },
                ]}
              />
            )}
          </div>
          {view === 'history' ? (
            <div className="p-4">
              <HistoryList kind="events" id={event.id} />
            </div>
          ) : occurrences.isLoading ? (
            <LoadingBlock />
          ) : occurrences.data?.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {occurrences.data.map((o) => (
                <EventOccurrenceRow key={o.id} occ={o} onOpen={setOpenId} showTitle={false} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={CalendarHeart} title={scope === 'upcoming' ? 'No upcoming occurrences' : 'No past occurrences'} />
          )}
        </section>
      </div>

      <EventOccurrenceDialog id={openId} onClose={() => setOpenId(null)} />
      <ConfirmDialog
        open={confirm === 'archive'}
        title="End this series?"
        message="No new occurrences will be created and untouched upcoming ones are removed. Completed, cancelled and past occurrences are kept."
        confirmLabel="End series"
        busy={action.isPending}
        onConfirm={() => runAction('archive')}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this event permanently?"
        message="This deletes the event and ALL of its occurrences. To keep history, use “End series” instead."
        confirmLabel="Delete permanently"
        danger
        busy={action.isPending}
        onConfirm={() => runAction('delete')}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
