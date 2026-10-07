import clsx from 'clsx';
import { Repeat } from 'lucide-react';
import { type EventOccurrence, formatClock, formatDate } from '@skr/core';
import { useSettings } from '../../hooks/useSettings';
import { CategoryDot, StatusBadge } from '../ui/misc';

export function EventOccurrenceRow({
  occ,
  onOpen,
  showTitle = true,
}: {
  occ: EventOccurrence;
  onOpen: (id: string) => void;
  showTitle?: boolean;
}) {
  const settings = useSettings();
  return (
    <li>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => onOpen(occ.id)}>
        <CategoryDot color={occ.category?.color} />
        <div className="min-w-0 flex-1">
          <p className={clsx('truncate text-sm font-medium', occ.status === 'CANCELLED' && 'line-through opacity-60')}>
            {showTitle ? occ.title : formatDate(occ.eventDate, settings.locale)}
            {occ.isRecurring && <Repeat className="ml-1.5 inline h-3 w-3 text-slate-400" aria-label="Recurring" />}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {showTitle && formatDate(occ.eventDate, settings.locale)}
            {occ.allDay ? ' · All day' : ` · ${formatClock(occ.startTime, settings.timeFormat)}${occ.endTime ? `–${formatClock(occ.endTime, settings.timeFormat)}` : ''}`}
            {occ.category && ` · ${occ.category.name}`}
          </p>
        </div>
        <StatusBadge status={occ.status} />
      </button>
    </li>
  );
}
