import { DateTime } from 'luxon';
import { Archive, CalendarHeart, Plus, Repeat, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCategories, useEventOccurrences, useEvents } from '../api/hooks';
import { EventOccurrenceDialog } from '../components/events/EventOccurrenceDialog';
import { EventOccurrenceRow } from '../components/events/EventOccurrenceRow';
import { CategoryDot, EmptyState, PageHeader, Segmented } from '../components/ui/misc';
import { LoadingBlock } from '../components/ui/Spinner';
import { useSettings } from '../hooks/useSettings';
import { describeRecurrence, formatClock, formatDate, todayIn, type EventOccurrenceQuery } from '@skr/core';

type Tab = 'upcoming' | 'completed' | 'all';

export function EventsPage() {
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'upcoming';
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const { data: categories = [] } = useCategories('EVENT');

  const today = todayIn(settings.timezone);
  const horizon = DateTime.fromISO(today).plus({ days: 90 }).toISODate()!;
  const occQuery: EventOccurrenceQuery =
    tab === 'upcoming'
      ? { start: today, end: horizon, status: 'UPCOMING', categoryId }
      : { status: 'COMPLETED', order: 'desc', limit: 100, categoryId };
  const occurrences = useEventOccurrences(occQuery, tab !== 'all');
  const events = useEvents({ search, categoryId, archived: showArchived ? 'true' : 'false' });
  const filtered = (occurrences.data ?? []).filter((o) => !search || o.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Birthdays, paydays, appointments and other reminders. Events never affect bill totals."
        actions={
          <Link to="/events/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden /> New event
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
            { value: 'completed', label: 'Completed' },
            { value: 'all', label: 'All events' },
          ]}
        />
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input className="input pl-8" placeholder="Search events" aria-label="Search events" value={search} onChange={(e) => setSearch(e.target.value)} />
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
          ) : filtered.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((o) => (
                <EventOccurrenceRow key={o.id} occ={o} onOpen={setOpenId} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={CalendarHeart} title={tab === 'completed' ? 'No completed events yet' : 'Nothing in the next 90 days'}>
              {tab === 'upcoming' && <Link to="/events/new" className="text-brand-600 hover:underline">Add an event</Link>}
            </EmptyState>
          )}
        </div>
      )}

      {tab === 'all' && (
        <>
          <label className="mb-3 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show ended series
          </label>
          {events.isLoading ? (
            <LoadingBlock />
          ) : events.data?.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {events.data.map((e) => (
                <Link key={e.id} to={`/events/${e.id}`} className="card block p-4 transition hover:border-brand-300 hover:shadow-md">
                  <p className="flex items-center gap-2 truncate font-medium">
                    <CategoryDot color={e.category?.color} /> {e.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{e.category?.name ?? 'Uncategorised'}</p>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="h-3 w-3" aria-hidden /> {describeRecurrence(e.recurrence, e.startDate)}
                    </span>
                    <span>{e.allDay ? 'All day' : formatClock(e.startTime, settings.timeFormat)}</span>
                    {e.isArchived && (
                      <span className="inline-flex items-center gap-1">
                        <Archive className="h-3 w-3" aria-hidden /> Ended
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs">
                    {e.nextDate ? <>Next <strong>{formatDate(e.nextDate, settings.locale)}</strong></> : <span className="text-slate-500">Nothing upcoming</span>}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="card">
              <EmptyState icon={CalendarHeart} title="No events yet">
                <Link to="/events/new" className="text-brand-600 hover:underline">Create an event</Link>
              </EmptyState>
            </div>
          )}
        </>
      )}

      <EventOccurrenceDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
