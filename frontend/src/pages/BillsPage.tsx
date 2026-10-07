import { DateTime } from 'luxon';
import { Archive, Plus, Receipt, Repeat, Search, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBillOccurrences, useBills, useCategories } from '../api/hooks';
import { BillOccurrenceDialog } from '../components/bills/BillOccurrenceDialog';
import { BillOccurrenceRow } from '../components/bills/BillOccurrenceRow';
import { CategoryDot, EmptyState, PageHeader, Segmented } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useSettings } from '../hooks/useSettings';
import { describeRecurrence, formatDate, formatMoney, todayIn } from '../lib/format';

type Tab = 'upcoming' | 'overdue' | 'completed' | 'all';

export function BillsPage() {
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'upcoming';
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { data: categories = [] } = useCategories('BILL');

  const today = todayIn(settings.timezone);
  const horizon = DateTime.fromISO(today).plus({ days: 60 }).toISODate()!;
  const occQuery =
    tab === 'upcoming'
      ? { start: today, end: horizon, status: 'PENDING', categoryId }
      : tab === 'overdue'
        ? { status: 'OVERDUE', categoryId }
        : { status: 'COMPLETED', order: 'desc', limit: 100, categoryId };
  const occurrences = useBillOccurrences(occQuery, tab !== 'all');
  const bills = useBills({ search, categoryId, archived: showArchived ? 'true' : 'false' });

  const money = (v: string) => formatMoney(v, settings.currency, settings.locale);
  const filteredOcc = (occurrences.data ?? []).filter((o) => !search || o.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Bills"
        subtitle="Each occurrence of a recurring bill is tracked on its own."
        actions={
          <Link to="/bills/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden /> New bill
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="View"
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'completed', label: 'Completed' },
            { value: 'all', label: 'All bills' },
          ]}
        />
        <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input className="input pl-8" placeholder="Search bills" aria-label="Search bills" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" aria-label="Filter by category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {tab !== 'all' && (
        <div className="card overflow-hidden">
          {occurrences.isLoading ? (
            <LoadingBlock />
          ) : filteredOcc.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredOcc.map((o) => (
                <BillOccurrenceRow key={o.id} occ={o} onOpen={setOpenId} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Receipt} title={tab === 'overdue' ? 'Nothing overdue 🎉' : tab === 'completed' ? 'No completed bills yet' : 'No bills due in the next 60 days'}>
              {tab === 'upcoming' && <Link to="/bills/new" className="text-brand-600 hover:underline">Add your first bill</Link>}
            </EmptyState>
          )}
        </div>
      )}

      {tab === 'all' && (
        <>
          <label className="mb-3 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show ended series
          </label>
          {bills.isLoading ? (
            <LoadingBlock />
          ) : bills.data?.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {bills.data.map((b) => (
                <Link key={b.id} to={`/bills/${b.id}`} className="card block p-4 transition hover:border-brand-300 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-medium">
                        <CategoryDot color={b.category?.color} /> {b.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{b.category?.name ?? 'Uncategorised'}</p>
                    </div>
                    <p className="font-semibold tabular-nums">{money(b.amount)}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="h-3 w-3" aria-hidden /> {describeRecurrence(b.recurrence, b.startDate)}
                    </span>
                    {b.paymentMethod !== 'MANUAL' && (
                      <span className="inline-flex items-center gap-1">
                        <Zap className="h-3 w-3 text-amber-500" aria-hidden /> Auto-pay
                      </span>
                    )}
                    {b.isArchived && (
                      <span className="inline-flex items-center gap-1">
                        <Archive className="h-3 w-3" aria-hidden /> Ended
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs">
                    {b.nextDueDate ? <>Next due <strong>{formatDate(b.nextDueDate, settings.locale)}</strong></> : <span className="text-slate-500">No upcoming due date</span>}
                    {Boolean(b.overdueCount) && <span className="ml-2 font-medium text-red-600">{b.overdueCount} overdue</span>}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="card">
              <EmptyState icon={Receipt} title="No bills yet">
                <Link to="/bills/new" className="text-brand-600 hover:underline">Create a bill</Link>
              </EmptyState>
            </div>
          )}
        </>
      )}

      <BillOccurrenceDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
