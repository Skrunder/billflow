import clsx from 'clsx';
import { AlertTriangle, CalendarCheck, CalendarClock, CheckCircle2, PartyPopper, Receipt, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDashboard } from '../api/hooks';
import { type BillOccurrence, type EventOccurrence, formatDate, formatMoney, type PeriodSummary } from '@skr/core';
import { BillOccurrenceDialog } from '../components/bills/BillOccurrenceDialog';
import { BillOccurrenceRow } from '../components/bills/BillOccurrenceRow';
import { EventOccurrenceDialog } from '../components/events/EventOccurrenceDialog';
import { EventOccurrenceRow } from '../components/events/EventOccurrenceRow';
import { EmptyState, ErrorNotice, PageHeader, Segmented } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useAuth } from '../auth/AuthProvider';
import { useSettings } from '../hooks/useSettings';

function StatCard({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub: ReactNode; icon: typeof Wallet; tone: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <span className={clsx('rounded-lg p-1.5', tone)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>
    </div>
  );
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="card-header">
        <h2 className="card-title">
          {title}
          {count !== undefined && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function BillList({ items, onOpen, empty }: { items: BillOccurrence[]; onOpen: (id: string, pay?: boolean) => void; empty: string }) {
  if (!items.length) return <EmptyState icon={CheckCircle2} title={empty} />;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((o) => (
        <BillOccurrenceRow key={o.id} occ={o} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function EventList({ items, onOpen, empty }: { items: EventOccurrence[]; onOpen: (id: string) => void; empty: string }) {
  if (!items.length) return <EmptyState icon={CalendarCheck} title={empty} />;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((o) => (
        <EventOccurrenceRow key={o.id} occ={o} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function progress(s: PeriodSummary) {
  const total = Number(s.total);
  return total > 0 ? Math.min(100, Math.round((Number(s.paid) / total) * 100)) : 0;
}

export function DashboardPage() {
  const { user } = useAuth();
  const settings = useSettings();
  const { data, isLoading, error } = useDashboard();
  const [bill, setBill] = useState<{ id: string; pay?: boolean } | null>(null);
  const openBill = (id: string, pay?: boolean) => setBill({ id, pay });
  const [eventId, setEventId] = useState<string | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('week');

  const money = (v: string) => formatMoney(v, settings.currency, settings.locale);
  // "~" when part of the amount still to pay is estimated.
  const approx = (p: PeriodSummary, v: string) => `${p.estimated ? '~' : ''}${money(v)}`;

  if (isLoading && !data) return <LoadingBlock />;
  if (!data) return <ErrorNotice error={error} />;

  const s = data.summary;
  const periodBills = period === 'week' ? data.billsDueThisWeek : data.billsDueThisMonth;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader title={`${greeting}, ${user?.displayName?.split(' ')[0] ?? ''}`} subtitle={formatDate(data.today, settings.locale, 'long')} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Due today"
          value={approx(s.today, s.today.remaining)}
          sub={`${s.today.counts.pending} bill${s.today.counts.pending === 1 ? '' : 's'} pending`}
          icon={Receipt}
          tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        />
        <StatCard
          label="This week"
          value={approx(s.week, s.week.remaining)}
          sub={`${money(s.week.paid)} paid of ${approx(s.week, s.week.total)}`}
          icon={CalendarClock}
          tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
        />
        <StatCard
          label="This month"
          value={`${progress(s.month)}% paid`}
          sub={
            <div>
              <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress(s.month)}%` }} />
              </div>
              {money(s.month.paid)} of {approx(s.month, s.month.total)}
            </div>
          }
          icon={Wallet}
          tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        />
        <StatCard
          label="Overdue"
          value={approx(s.overdue, s.overdue.remaining)}
          sub={`${s.overdue.counts.overdue} bill${s.overdue.counts.overdue === 1 ? '' : 's'}`}
          icon={AlertTriangle}
          tone="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {data.overdueBills.length > 0 && (
          <div className="lg:col-span-2">
            <Section title="Overdue bills" count={data.overdueBills.length}>
              <BillList items={data.overdueBills} onOpen={openBill} empty="Nothing overdue" />
            </Section>
          </div>
        )}

        <Section title="Bills due today" count={data.billsDueToday.length}>
          <BillList items={data.billsDueToday} onOpen={openBill} empty="Nothing due today" />
        </Section>

        <Section title="Upcoming events" count={data.upcomingEvents.length} action={<Link to="/events" className="text-xs font-medium text-brand-600 hover:underline">All events</Link>}>
          <EventList items={data.upcomingEvents} onOpen={setEventId} empty="No events in the next 30 days" />
        </Section>

        <div className="lg:col-span-2">
          <Section
            title={period === 'week' ? 'Bills due this week' : 'Bills due this month'}
            count={periodBills.length}
            action={
              <Segmented
                label="Period"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                ]}
              />
            }
          >
            <BillList items={periodBills} onOpen={openBill} empty={`No bills this ${period}`} />
          </Section>
        </div>

        <Section title="Recently completed bills">
          <BillList items={data.recentlyCompletedBills} onOpen={openBill} empty="No completed bills yet" />
        </Section>
        <Section title="Recently completed events">
          {data.recentlyCompletedEvents.length ? (
            <EventList items={data.recentlyCompletedEvents} onOpen={setEventId} empty="" />
          ) : (
            <EmptyState icon={PartyPopper} title="No completed events yet" />
          )}
        </Section>
      </div>

      <BillOccurrenceDialog id={bill?.id ?? null} pay={bill?.pay} onClose={() => setBill(null)} />
      <EventOccurrenceDialog id={eventId} onClose={() => setEventId(null)} />
    </>
  );
}
