import { Archive, ArchiveRestore, Pencil, Receipt, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useBill, useBillOccurrences, useBillTemplateAction } from '../api/hooks';
import { BillOccurrenceDialog } from '../components/bills/BillOccurrenceDialog';
import { BillOccurrenceRow } from '../components/bills/BillOccurrenceRow';
import { HistoryList } from '../components/shared/HistoryList';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CategoryDot, EmptyState, ErrorNotice, EstimateTag, PageHeader, Segmented } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { useCanEdit } from '../hooks/useCanEdit';
import { useSettings } from '../hooks/useSettings';
import { describeOffset, describeRecurrence, formatClock, formatDate, formatMoney, PAYMENT_METHOD_LABEL, todayIn } from '@skr/core';

export function BillDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useSettings();
  const canEdit = useCanEdit();
  const { data: bill, isLoading, error } = useBill(id);
  const [view, setView] = useState<'occurrences' | 'history'>('occurrences');
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const action = useBillTemplateAction();
  const today = todayIn(settings.timezone);
  const occurrences = useBillOccurrences(
    scope === 'upcoming' ? { billId: id, start: today, limit: 60 } : { billId: id, end: today, order: 'desc', limit: 200 },
    Boolean(id),
  );
  const openId = params.get('occurrence');
  const setOpenId = (o: string | null, pay?: boolean) => setParams(o ? { occurrence: o, ...(pay ? { pay: '1' } : {}) } : {}, { replace: true });

  if (isLoading) return <LoadingBlock />;
  if (!bill) return <ErrorNotice error={error ?? new Error('Bill not found')} />;

  const money = (v: string) => formatMoney(v, settings.currency, settings.locale);

  const runAction = (a: 'archive' | 'unarchive' | 'delete') =>
    action.mutate(
      { id: bill.id, action: a },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success(a === 'delete' ? 'Bill deleted' : a === 'archive' ? 'Series ended' : 'Series resumed');
          if (a === 'delete') navigate('/bills?tab=all', { replace: true });
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <>
      <PageHeader
        title={bill.name}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <CategoryDot color={bill.category?.color} /> {bill.category?.name ?? 'Uncategorised'}
            {bill.isArchived && ' · Series ended'}
          </span>
        }
        actions={
          canEdit && (
            <>
              <Link to={`/bills/${bill.id}/edit`} className="btn-secondary">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </Link>
              {bill.isRecurring &&
                (bill.isArchived ? (
                  <button className="btn-secondary" onClick={() => runAction('unarchive')}>
                    <ArchiveRestore className="h-4 w-4" aria-hidden /> Resume
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={() => setConfirm('archive')}>
                    <Archive className="h-4 w-4" aria-hidden /> End series
                  </button>
                ))}
              <button className="btn-secondary text-red-600 dark:text-red-400" onClick={() => setConfirm('delete')}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </button>
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-1">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Amount</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {money(bill.amount)}
                {bill.amountIsEstimate && <EstimateTag className="text-xs/5" />}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Schedule</dt>
              <dd>{describeRecurrence(bill.recurrence, bill.startDate)}</dd>
              {bill.recurrence?.rrule && <dd className="mt-0.5 font-mono text-[11px]/5 text-slate-400">{bill.recurrence.rrule}</dd>}
            </div>
            <div>
              <dt className="text-xs text-slate-500">{bill.isRecurring ? 'Starts' : 'Due'}</dt>
              <dd>
                {formatDate(bill.startDate, settings.locale)}
                {bill.dueTime && ` · ${formatClock(bill.dueTime, settings.timeFormat)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Payment</dt>
              <dd>
                {PAYMENT_METHOD_LABEL[bill.paymentMethod]}
                {bill.paymentMethod === 'SCHEDULED_AUTOPAY' && ` · ${bill.scheduledPayDaysBefore} day(s) before due`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Reminders</dt>
              <dd>{bill.reminderOffsets.length ? bill.reminderOffsets.map(describeOffset).join(', ') : 'None'}</dd>
            </div>
            {bill.description && (
              <div>
                <dt className="text-xs text-slate-500">Description</dt>
                <dd>{bill.description}</dd>
              </div>
            )}
            {bill.notes && (
              <div>
                <dt className="text-xs text-slate-500">Notes</dt>
                <dd className="whitespace-pre-line">{bill.notes}</dd>
              </div>
            )}
            {bill.stats && (
              <div className="grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-center dark:border-slate-800">
                <div>
                  <p className="text-lg font-semibold">{bill.stats.COMPLETED?.count ?? 0}</p>
                  <p className="text-xs text-slate-500">Paid</p>
                </div>
                <div>
                  <p className="text-lg font-semibold">{bill.stats.PENDING?.count ?? 0}</p>
                  <p className="text-xs text-slate-500">Pending</p>
                </div>
                <div>
                  <p className="text-lg font-semibold">{bill.stats.SKIPPED?.count ?? 0}</p>
                  <p className="text-xs text-slate-500">Skipped</p>
                </div>
                <p className="col-span-3 text-xs text-slate-500">Total paid: {money(bill.stats.COMPLETED?.amountPaid ?? '0')}</p>
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
              <HistoryList kind="bills" id={bill.id} />
            </div>
          ) : occurrences.isLoading ? (
            <LoadingBlock />
          ) : occurrences.data?.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {occurrences.data.map((o) => (
                <BillOccurrenceRow key={o.id} occ={o} onOpen={setOpenId} showName={false} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Receipt} title={scope === 'upcoming' ? 'No upcoming occurrences' : 'No past occurrences'} />
          )}
        </section>
      </div>

      <BillOccurrenceDialog id={openId} pay={params.get('pay') === '1'} onClose={() => setOpenId(null)} />
      <ConfirmDialog
        open={confirm === 'archive'}
        title="End this series?"
        message="No new occurrences will be created and untouched upcoming ones are removed. Paid, skipped and past occurrences — and their history — are kept."
        confirmLabel="End series"
        busy={action.isPending}
        onConfirm={() => runAction('archive')}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this bill permanently?"
        message="This deletes the bill and ALL of its occurrences, including payment history. To keep history, use “End series” instead."
        confirmLabel="Delete permanently"
        danger
        busy={action.isPending}
        onConfirm={() => runAction('delete')}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
