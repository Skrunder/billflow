import { DateTime } from 'luxon';
import type { Recurrence } from '../api/types';

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatMoney(amount: string | number | null | undefined, currency = 'USD', locale = 'en-US'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = typeof amount === 'number' ? amount : Number(amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

/** Calendar date "YYYY-MM-DD" (already a local day — no timezone shift). */
export function formatDate(iso: string | null | undefined, locale = 'en-US', style: 'short' | 'medium' | 'long' = 'medium') {
  if (!iso) return '—';
  const d = DateTime.fromISO(iso, { zone: 'utc' }).setLocale(locale);
  if (style === 'short') return d.toFormat('LLL d');
  if (style === 'long') return d.toFormat('cccc, LLLL d, yyyy');
  return d.toFormat('ccc, LLL d, yyyy');
}

/** Local wall-clock "HH:mm" → display string. */
export function formatClock(time: string | null | undefined, timeFormat: '12h' | '24h' = '12h') {
  if (!time) return '';
  if (timeFormat === '24h') return time;
  const [h, m] = time.split(':').map(Number) as [number, number];
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** UTC instant → date + time in the user's timezone. */
export function formatInstant(iso: string | null | undefined, tz: string, locale = 'en-US', timeFormat: '12h' | '24h' = '12h') {
  if (!iso) return '—';
  const d = DateTime.fromISO(iso).setZone(tz).setLocale(locale);
  return d.toFormat(`LLL d, yyyy ${timeFormat === '24h' ? 'HH:mm' : 'h:mm a'}`);
}

export function todayIn(tz: string): string {
  return DateTime.now().setZone(tz).toISODate()!;
}

/** "Today", "Tomorrow", "in 3 days", "2 days ago". */
export function relativeDay(iso: string, today: string): string {
  const diff = Math.round(DateTime.fromISO(iso, { zone: 'utc' }).diff(DateTime.fromISO(today, { zone: 'utc' }), 'days').days);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

const UNIT: Record<Recurrence['frequency'], [string, string]> = {
  DAILY: ['day', 'days'],
  WEEKLY: ['week', 'weeks'],
  MONTHLY: ['month', 'months'],
  YEARLY: ['year', 'years'],
};

export function describeRecurrence(r: Omit<Recurrence, 'rrule'> | null | undefined, startDate?: string): string {
  if (!r) return 'One time';
  const [one, many] = UNIT[r.frequency];
  let text = r.interval > 1 ? `Every ${r.interval} ${many}` : `Every ${one}`;
  if (r.interval === 1) {
    text = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' }[r.frequency];
  }
  if (r.frequency === 'WEEKLY' && r.byWeekday.length) {
    text += ` on ${[...r.byWeekday].sort().map((d) => WEEKDAYS_SHORT[d]).join(', ')}`;
  } else if (r.frequency === 'MONTHLY' && startDate) {
    text += ` on day ${Number(startDate.slice(8, 10))}`;
  } else if (r.frequency === 'YEARLY' && startDate) {
    text += ` on ${DateTime.fromISO(startDate).toFormat('LLL d')}`;
  }
  if (r.count) text += `, ${r.count} times`;
  else if (r.endDate) text += `, until ${formatDate(r.endDate, 'en-US', 'medium')}`;
  return text;
}

export function describeOffset(minutes: number): string {
  if (minutes === 0) return 'At time of event';
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes === 10080 ? '' : 's'} before`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'} before`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'} before`;
  return `${minutes} minutes before`;
}

export const PAYMENT_METHOD_LABEL = {
  MANUAL: 'Manual payment',
  AUTOPAY: 'Auto-pay',
  SCHEDULED_AUTOPAY: 'Scheduled auto-pay',
} as const;
