import { Ban, Check, ExternalLink, Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useEventOccurrence, useEventOccurrenceAction, type EventOccurrenceAction } from '../../api/hooks';
import { useCanEdit } from '../../hooks/useCanEdit';
import { useSettings } from '../../hooks/useSettings';
import { formatClock, formatDate, formatInstant } from '@skr/core';
import { HistoryList } from '../shared/HistoryList';
import { CategoryDot, Field, Segmented, StatusBadge } from '../ui/misc';
import { Modal } from '../ui/Modal';
import { LoadingBlock, Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';

/** Detail + actions for ONE event occurrence; siblings are never affected. */
export function EventOccurrenceDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const settings = useSettings();
  const canEdit = useCanEdit();
  const toast = useToast();
  const { data: occ, isLoading } = useEventOccurrence(id);
  const action = useEventOccurrenceAction();
  const [tab, setTab] = useState<'details' | 'history'>('details');
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setTab('details');
    setEditing(false);
  }, [id]);

  useEffect(() => {
    if (!occ) return;
    setDate(occ.eventDate);
    setStart(occ.startTime ?? '');
    setEnd(occ.endTime ?? '');
    setNotes(occ.notes ?? '');
  }, [occ]);

  const run = (a: EventOccurrenceAction, success: string) =>
    action.mutate(a, {
      onSuccess: () => {
        toast.success(success);
        setEditing(false);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  const footer =
    occ && canEdit && !editing ? (
      occ.status === 'UPCOMING' ? (
        <>
          <button className="btn-secondary" onClick={() => run({ id: occ.id, action: 'cancel' }, 'Occurrence cancelled')} disabled={action.isPending}>
            <Ban className="h-4 w-4" aria-hidden /> Cancel occurrence
          </button>
          <button className="btn-success" onClick={() => run({ id: occ.id, action: 'complete' }, 'Marked completed')} disabled={action.isPending}>
            <Check className="h-4 w-4" aria-hidden /> Mark completed
          </button>
        </>
      ) : (
        <button className="btn-secondary" onClick={() => run({ id: occ.id, action: 'reopen' }, 'Occurrence reopened')} disabled={action.isPending}>
          <RotateCcw className="h-4 w-4" aria-hidden /> Reopen
        </button>
      )
    ) : null;

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={occ ? occ.title : 'Event'} footer={footer}>
      {isLoading || !occ ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented
              label="Section"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'details', label: 'Details' },
                { value: 'history', label: 'History' },
              ]}
            />
            <StatusBadge status={occ.status} />
          </div>

          {tab === 'history' && <HistoryList kind="event-occurrences" id={occ.id} />}

          {tab === 'details' && !editing && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Date</dt>
                  <dd className="font-medium">{formatDate(occ.eventDate, settings.locale)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Time</dt>
                  <dd>
                    {occ.allDay
                      ? 'All day'
                      : `${formatClock(occ.startTime, settings.timeFormat)}${occ.endTime ? ` – ${formatClock(occ.endTime, settings.timeFormat)}` : ''}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Category</dt>
                  <dd className="flex items-center gap-1.5">
                    <CategoryDot color={occ.category?.color} /> {occ.category?.name ?? 'Uncategorised'}
                  </dd>
                </div>
                {occ.location && (
                  <div>
                    <dt className="text-xs text-slate-500">Location</dt>
                    <dd>{occ.location}</dd>
                  </div>
                )}
                {occ.completedAt && (
                  <div>
                    <dt className="text-xs text-slate-500">Completed</dt>
                    <dd>{formatInstant(occ.completedAt, settings.timezone, settings.locale, settings.timeFormat)}</dd>
                  </div>
                )}
                {occ.description && (
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Description</dt>
                    <dd>{occ.description}</dd>
                  </div>
                )}
                {occ.notes && (
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Notes</dt>
                    <dd className="whitespace-pre-line">{occ.notes}</dd>
                  </div>
                )}
              </dl>
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                {canEdit && (
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit this occurrence
                  </button>
                )}
                <Link to={`/events/${occ.eventId}`} className="btn-ghost btn-sm" onClick={onClose}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> {occ.isRecurring ? 'View series' : 'View event'}
                </Link>
              </div>
            </>
          )}

          {tab === 'details' && editing && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  { id: occ.id, action: 'update', body: { eventDate: date, startTime: start || null, endTime: start && end ? end : null, notes: notes.trim() || null } },
                  'Occurrence updated',
                );
              }}
            >
              <p className="text-sm text-slate-600 dark:text-slate-300">Changes here apply only to this occurrence.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Date">
                  {(fid) => <input id={fid} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />}
                </Field>
                <Field label="Start" hint="Empty = all day">
                  {(fid) => <input id={fid} type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />}
                </Field>
                <Field label="End">
                  {(fid) => <input id={fid} type="time" className="input" value={end} disabled={!start} onChange={(e) => setEnd(e.target.value)} />}
                </Field>
              </div>
              <Field label="Notes">
                {(fid) => <textarea id={fid} className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
                  Back
                </button>
                <button type="submit" className="btn-primary" disabled={action.isPending}>
                  {action.isPending && <Spinner className="h-4 w-4 text-white" />}
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
