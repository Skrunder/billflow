import { DateTime } from 'luxon';
import { Check, ExternalLink, Pencil, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useBillOccurrence, useBillOccurrenceAction, type BillOccurrenceAction } from '../../api/hooks';
import { useCanEdit } from '../../hooks/useCanEdit';
import { useSettings } from '../../hooks/useSettings';
import { formatClock, formatDate, formatInstant, formatMoney, PAYMENT_METHOD_LABEL } from '../../lib/format';
import { HistoryList } from '../shared/HistoryList';
import { CategoryDot, Field, Segmented, StatusBadge } from '../ui/misc';
import { Modal } from '../ui/Modal';
import { LoadingBlock, Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';

type Mode = 'view' | 'complete' | 'edit';

/**
 * Detail + actions for ONE bill occurrence. Every action here targets only
 * this occurrence; other occurrences of the same recurring bill are untouched.
 */
export function BillOccurrenceDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const settings = useSettings();
  const canEdit = useCanEdit();
  const toast = useToast();
  const { data: occ, isLoading } = useBillOccurrence(id);
  const action = useBillOccurrenceAction();
  const [tab, setTab] = useState<'details' | 'history'>('details');
  const [mode, setMode] = useState<Mode>('view');

  // complete form
  const [paidAmount, setPaidAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [confirmation, setConfirmation] = useState('');
  // edit form
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    setTab('details');
    setMode('view');
  }, [id]);

  useEffect(() => {
    if (!occ) return;
    setPaidAmount(occ.amount);
    setPaidOn(DateTime.now().setZone(settings.timezone).toFormat("yyyy-LL-dd'T'HH:mm"));
    setConfirmation(occ.confirmationNumber ?? '');
    setEditDate(occ.dueDate);
    setEditTime(occ.dueTime ?? '');
    setEditAmount(occ.amount);
    setEditNotes(occ.notes ?? '');
  }, [occ, settings.timezone]);

  const run = (a: BillOccurrenceAction, success: string) =>
    action.mutate(a, {
      onSuccess: () => {
        toast.success(success);
        setMode('view');
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  const money = (v: string | null) => formatMoney(v, settings.currency, settings.locale);
  const actionable = occ && (occ.status === 'PENDING' || occ.status === 'OVERDUE');

  const footer =
    occ && canEdit && mode === 'view' ? (
      <>
        {actionable && (
          <>
            <button className="btn-secondary" onClick={() => run({ id: occ.id, action: 'skip' }, 'Occurrence skipped')} disabled={action.isPending}>
              <SkipForward className="h-4 w-4" aria-hidden /> Skip
            </button>
            <button className="btn-success" onClick={() => setMode('complete')}>
              <Check className="h-4 w-4" aria-hidden /> Mark paid
            </button>
          </>
        )}
        {!actionable && (
          <button className="btn-secondary" onClick={() => run({ id: occ.id, action: 'reopen' }, 'Occurrence reopened')} disabled={action.isPending}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Reopen
          </button>
        )}
      </>
    ) : null;

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={occ ? occ.name : 'Bill'} footer={footer}>
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

          {tab === 'history' && <HistoryList kind="bill-occurrences" id={occ.id} />}

          {tab === 'details' && mode === 'view' && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Due</dt>
                  <dd className="font-medium">
                    {formatDate(occ.dueDate, settings.locale)}
                    {occ.dueTime && ` · ${formatClock(occ.dueTime, settings.timeFormat)}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Amount</dt>
                  <dd className="font-medium tabular-nums">{money(occ.amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Payment</dt>
                  <dd>
                    {PAYMENT_METHOD_LABEL[occ.paymentMethod]}
                    {occ.scheduledPayDate && occ.paymentMethod === 'SCHEDULED_AUTOPAY' && ` (${formatDate(occ.scheduledPayDate, settings.locale, 'short')})`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Category</dt>
                  <dd className="flex items-center gap-1.5">
                    <CategoryDot color={occ.category?.color} /> {occ.category?.name ?? 'Uncategorised'}
                  </dd>
                </div>
                {occ.status === 'COMPLETED' && (
                  <>
                    <div>
                      <dt className="text-xs text-slate-500">Completed</dt>
                      <dd>{formatInstant(occ.completedAt, settings.timezone, settings.locale, settings.timeFormat)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Amount paid</dt>
                      <dd className="tabular-nums">{money(occ.amountPaid)}</dd>
                    </div>
                  </>
                )}
                {occ.confirmationNumber && (
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Confirmation #</dt>
                    <dd className="font-mono text-xs">{occ.confirmationNumber}</dd>
                  </div>
                )}
                {occ.notes && (
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Notes</dt>
                    <dd className="whitespace-pre-line">{occ.notes}</dd>
                  </div>
                )}
              </dl>
              {occ.isModified && <p className="text-xs text-slate-500">This occurrence was edited individually and won&apos;t be changed by edits to the series.</p>}
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                {canEdit && (
                  <button className="btn-ghost btn-sm" onClick={() => setMode('edit')}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit this occurrence
                  </button>
                )}
                <Link to={`/bills/${occ.billId}`} className="btn-ghost btn-sm" onClick={onClose}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  {occ.isRecurring ? 'View series' : 'View bill'}
                </Link>
              </div>
            </>
          )}

          {tab === 'details' && mode === 'complete' && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const completedAt = DateTime.fromISO(paidOn, { zone: settings.timezone });
                run(
                  {
                    id: occ.id,
                    action: 'complete',
                    body: {
                      amountPaid: paidAmount.trim() || null,
                      confirmationNumber: confirmation.trim() || null,
                      ...(completedAt.isValid ? { completedAt: completedAt.toISO()! } : {}),
                    },
                  },
                  'Marked as paid',
                );
              }}
            >
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Mark the <strong>{formatDate(occ.dueDate, settings.locale)}</strong> occurrence as paid. Other occurrences stay as they are.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount paid">
                  {(fid) => <input id={fid} className="input" inputMode="decimal" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />}
                </Field>
                <Field label="Paid on">
                  {(fid) => <input id={fid} type="datetime-local" className="input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
                </Field>
              </div>
              <Field label="Confirmation number (optional)">
                {(fid) => <input id={fid} className="input" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} maxLength={120} />}
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setMode('view')}>
                  Back
                </button>
                <button type="submit" className="btn-success" disabled={action.isPending}>
                  {action.isPending && <Spinner className="h-4 w-4 text-white" />}
                  Confirm payment
                </button>
              </div>
            </form>
          )}

          {tab === 'details' && mode === 'edit' && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  {
                    id: occ.id,
                    action: 'update',
                    body: { dueDate: editDate, dueTime: editTime || null, amount: editAmount.trim(), notes: editNotes.trim() || null },
                  },
                  'Occurrence updated',
                );
              }}
            >
              <p className="text-sm text-slate-600 dark:text-slate-300">Changes here apply only to this occurrence.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Due date">
                  {(fid) => <input id={fid} type="date" className="input" value={editDate} onChange={(e) => setEditDate(e.target.value)} required />}
                </Field>
                <Field label="Due time" hint="Optional">
                  {(fid) => <input id={fid} type="time" className="input" value={editTime} onChange={(e) => setEditTime(e.target.value)} />}
                </Field>
                <Field label="Amount">
                  {(fid) => <input id={fid} className="input" inputMode="decimal" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />}
                </Field>
              </div>
              <Field label="Notes">
                {(fid) => <textarea id={fid} className="input min-h-[70px]" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />}
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setMode('view')}>
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
