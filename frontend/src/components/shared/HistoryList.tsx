import { History } from 'lucide-react';
import { useHistory } from '../../api/hooks';
import { useSettings } from '../../hooks/useSettings';
import { formatInstant } from '../../lib/format';
import { LoadingBlock } from '../ui/Spinner';

const ACTION_LABEL: Record<string, string> = {
  CREATED: 'Created',
  UPDATED: 'Edited',
  COMPLETED: 'Marked completed',
  SKIPPED: 'Skipped',
  CANCELLED: 'Cancelled',
  REOPENED: 'Reopened',
  AUTOPAY_COMPLETED: 'Completed by auto-pay',
  ARCHIVED: 'Series ended',
  UNARCHIVED: 'Series resumed',
  DELETED: 'Deleted',
};

const HIDDEN = new Set(['updatedAt', 'isModified', 'dueAt', 'startAt', 'endAt', 'autopayAt', 'scheduledPayDate', 'generatedUntil']);

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v)) return v.slice(0, 10);
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Audit trail for one bill/event template or one occurrence. */
export function HistoryList({ kind, id }: { kind: 'bills' | 'bill-occurrences' | 'events' | 'event-occurrences'; id: string }) {
  const settings = useSettings();
  const { data, isLoading } = useHistory(kind, id);
  if (isLoading) return <LoadingBlock label="Loading history…" />;
  if (!data?.length)
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <History className="h-4 w-4" aria-hidden /> No changes recorded yet.
      </p>
    );
  return (
    <ol className="space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
      {data.map((h) => {
        const changes = Object.entries(h.changes ?? {}).filter(
          ([k, v]) => !HIDDEN.has(k) && v && typeof v === 'object' && 'to' in (v as object),
        ) as [string, { from: unknown; to: unknown }][];
        return (
          <li key={h.id} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" aria-hidden />
            <p className="text-sm font-medium">
              {ACTION_LABEL[h.action] ?? h.action}
              {h.actorType === 'SYSTEM' && <span className="ml-1 text-xs font-normal text-slate-500">(automatic)</span>}
            </p>
            <p className="text-xs text-slate-500">{formatInstant(h.createdAt, settings.timezone, settings.locale, settings.timeFormat)}</p>
            {changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                {changes.slice(0, 6).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-medium">{k}</span>: {show(v.from)} → {show(v.to)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
