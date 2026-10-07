import type { DatesSetArg, EventClickArg, EventContentArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import luxonPlugin from '@fullcalendar/luxon3';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { CalendarHeart, Receipt } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalendar } from '../api/hooks';
import { type CalendarItem, formatDate, formatMoney } from '@skr/core';
import { BillOccurrenceDialog } from '../components/bills/BillOccurrenceDialog';
import { EventOccurrenceDialog } from '../components/events/EventOccurrenceDialog';
import { Modal } from '../components/ui/Modal';
import { PageHeader, Segmented } from '../components/ui/misc';
import { Spinner } from '../components/ui/Spinner';
import { useCanEdit } from '../hooks/useCanEdit';
import { useMediaQuery, useSettings } from '../hooks/useSettings';

type Filter = 'all' | 'bills' | 'events';

const FILTER_KEY = 'skr-calendar-filter';

function readFilter(): Filter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    return v === 'bills' || v === 'events' ? v : 'all';
  } catch {
    return 'all';
  }
}

export default function CalendarPage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const isMobile = useMediaQuery('(max-width: 640px)');
  const [filter, setFilterState] = useState<Filter>(readFilter);
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [billId, setBillId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);
  const { data, isFetching } = useCalendar(range?.start ?? null, range?.end ?? null, filter);

  const setFilter = (f: Filter) => {
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* ignore */
    }
  };

  const events: EventInput[] = useMemo(
    () =>
      (data?.items ?? []).map((i: CalendarItem) => {
        const done = i.status === 'COMPLETED' || i.status === 'SKIPPED' || i.status === 'CANCELLED';
        const color = i.kind === 'bill' ? (i.status === 'OVERDUE' ? '#dc2626' : (i.color ?? '#4f46e5')) : (i.color ?? '#0ea5e9');
        return {
          id: i.id,
          title: i.kind === 'bill' ? `${formatMoney(i.amount, settings.currency, settings.locale)} ${i.title}` : i.title,
          start: i.start,
          end: i.end ?? undefined,
          allDay: i.allDay,
          backgroundColor: color,
          borderColor: color,
          classNames: [done ? 'is-done' : '', i.status === 'OVERDUE' ? 'is-overdue' : '', `kind-${i.kind}`],
          extendedProps: { item: i },
        };
      }),
    [data, settings.currency, settings.locale],
  );

  const onDatesSet = (arg: DatesSetArg) => {
    // FullCalendar's end is exclusive; the API range is inclusive.
    // startStr/endStr are already expressed in the calendar's (user's) timezone.
    const start = arg.startStr.slice(0, 10);
    const end = DateTime.fromISO(arg.endStr.slice(0, 10), { zone: 'utc' }).minus({ days: 1 }).toISODate()!;
    setRange((r) => (r?.start === start && r.end === end ? r : { start, end }));
  };

  const onEventClick = (arg: EventClickArg) => {
    const item = arg.event.extendedProps.item as CalendarItem;
    if (item.kind === 'bill') setBillId(item.occurrenceId);
    else setEventId(item.occurrenceId);
  };

  const renderEvent = (arg: EventContentArg) => {
    const item = arg.event.extendedProps.item as CalendarItem;
    const icon = item.kind === 'bill' ? '💵' : '📅';
    return (
      <div className="flex min-w-0 items-center gap-1 overflow-hidden px-1 text-xs" title={`${item.kind === 'bill' ? 'Bill' : 'Event'}: ${item.title} (${item.status.toLowerCase()})`}>
        <span aria-hidden>{icon}</span>
        {arg.timeText && <span className="shrink-0 opacity-80">{arg.timeText}</span>}
        <span className="truncate fc-event-title">{arg.event.title}</span>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={<>Times shown in {settings.timezone}{isFetching && <Spinner className="ml-2 inline h-3 w-3" />}</>}
        actions={
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Bills & Events' },
              { value: 'bills', label: 'Bills' },
              { value: 'events', label: 'Events' },
            ]}
          />
        }
      />
      <div className="card p-2 sm:p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          initialView={isMobile && settings.defaultCalendarView === 'dayGridMonth' ? 'listMonth' : settings.defaultCalendarView}
          timeZone={settings.timezone}
          locale={settings.locale}
          firstDay={settings.weekStartsOn}
          headerToolbar={
            isMobile
              ? { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' }
              : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth' }
          }
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'Agenda' }}
          views={{ listMonth: { buttonText: 'Agenda' } }}
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', hour12: settings.timeFormat === '12h' }}
          slotLabelFormat={{ hour: 'numeric', minute: '2-digit', hour12: settings.timeFormat === '12h' }}
          height="auto"
          dayMaxEvents={4}
          nowIndicator
          events={events}
          datesSet={onDatesSet}
          eventClick={onEventClick}
          eventContent={renderEvent}
          dateClick={(arg: DateClickArg) => canEdit && setAddDate(arg.dateStr.slice(0, 10))}
          noEventsContent="Nothing scheduled in this period"
        />
      </div>

      <Modal open={Boolean(addDate)} onClose={() => setAddDate(null)} title={addDate ? `Add on ${formatDate(addDate, settings.locale)}` : ''} size="sm">
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secondary flex-col py-5" onClick={() => navigate(`/bills/new?date=${addDate}`)}>
            <Receipt className="h-6 w-6 text-brand-600" aria-hidden /> Bill
          </button>
          <button className="btn-secondary flex-col py-5" onClick={() => navigate(`/events/new?date=${addDate}`)}>
            <CalendarHeart className="h-6 w-6 text-sky-600" aria-hidden /> Event
          </button>
        </div>
      </Modal>

      <BillOccurrenceDialog id={billId} onClose={() => setBillId(null)} />
      <EventOccurrenceDialog id={eventId} onClose={() => setEventId(null)} />
    </>
  );
}
