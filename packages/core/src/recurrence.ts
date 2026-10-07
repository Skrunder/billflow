import { DateTime } from 'luxon';
import type { Frequency } from './types.js';

/**
 * Pure recurrence expansion on calendar dates (no timezones involved — the
 * result is a list of local "YYYY-MM-DD" days).
 *
 * Every date is computed from the start date (not from the previous date), so
 * a bill on the 31st lands on Feb 28/29 and returns to the 31st in March.
 */

export interface RecurrenceSpec {
  frequency: Frequency;
  /** Every N units — "custom interval" is any interval > 1 (e.g. every 2 weeks). */
  interval: number;
  /** WEEKLY only. 0 = Sunday … 6 = Saturday. Empty = weekday of the start date. */
  byWeekday?: number[];
  /** Inclusive last possible date. */
  endDate?: string | null;
  /** Maximum number of occurrences counted from the start date. */
  count?: number | null;
}

const MAX_ITERATIONS = 200_000;

function* iterate(start: string, spec: RecurrenceSpec | null): Generator<string> {
  const s = DateTime.fromISO(start, { zone: 'utc' });
  if (!spec) {
    yield start;
    return;
  }
  const interval = Math.max(1, Math.floor(spec.interval || 1));

  if (spec.frequency === 'WEEKLY') {
    const startDow = s.weekday % 7;
    const days = [...new Set(spec.byWeekday && spec.byWeekday.length ? spec.byWeekday : [startDow])].sort((a, b) => a - b);
    const weekStart = s.minus({ days: startDow }); // Sunday-aligned week
    for (let w = 0; w < MAX_ITERATIONS; w++) {
      for (const dow of days) {
        const d = weekStart.plus({ days: w * interval * 7 + dow });
        if (d < s) continue;
        yield d.toISODate()!;
      }
    }
    return;
  }

  for (let k = 0; k < MAX_ITERATIONS; k++) {
    const n = k * interval;
    let d: DateTime;
    switch (spec.frequency) {
      case 'DAILY':
        d = s.plus({ days: n });
        break;
      case 'MONTHLY':
        d = s.plus({ months: n }); // luxon clamps to month end
        break;
      case 'YEARLY':
        d = s.plus({ years: n }); // Feb 29 → Feb 28 in non-leap years
        break;
      default:
        return;
    }
    yield d.toISODate()!;
  }
}

/**
 * All occurrence dates of the schedule that fall within [rangeStart, rangeEnd].
 * COUNT is always applied from the very first occurrence so results are stable
 * regardless of the requested range.
 */
export function expandDates(
  start: string,
  spec: RecurrenceSpec | null,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const out: string[] = [];
  let index = 0;
  for (const d of iterate(start, spec)) {
    if (d > rangeEnd) break;
    if (spec?.endDate && d > spec.endDate) break;
    if (spec?.count && index >= spec.count) break;
    index++;
    if (d >= rangeStart) out.push(d);
  }
  return out;
}

const RRULE_FREQ: Record<Frequency, string> = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
};
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** RFC 5545 RRULE string, for interoperability (iCal / Google / Outlook sync). */
export function toRRule(spec: RecurrenceSpec | null): string | null {
  if (!spec) return null;
  const parts = [`FREQ=${RRULE_FREQ[spec.frequency]}`];
  if (spec.interval > 1) parts.push(`INTERVAL=${spec.interval}`);
  if (spec.frequency === 'WEEKLY' && spec.byWeekday?.length) {
    parts.push(`BYDAY=${spec.byWeekday.map((d) => RRULE_DAYS[d]).join(',')}`);
  }
  if (spec.count) parts.push(`COUNT=${spec.count}`);
  if (spec.endDate) parts.push(`UNTIL=${spec.endDate.replace(/-/g, '')}`);
  return parts.join(';');
}
