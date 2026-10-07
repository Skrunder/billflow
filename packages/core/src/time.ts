import { DateTime } from 'luxon';

/**
 * Date helpers. Two kinds of values flow through the app:
 *   - ISO calendar dates "YYYY-MM-DD" (a user's local day, stored as DATE)
 *   - UTC instants (JS Date, stored as timestamptz)
 * Prisma represents DATE columns as a JS Date at UTC midnight.
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function isValidIsoDate(s: string): boolean {
  return ISO_DATE_RE.test(s) && DateTime.fromISO(s, { zone: 'utc' }).isValid;
}

/** DATE column value → "YYYY-MM-DD". */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → Date at UTC midnight (what Prisma expects for DATE columns). */
export function fromIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).plus({ days }).toISODate()!;
}

export function todayInZone(tz: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(tz).toISODate()!;
}

/** Local date + local time in a zone → UTC instant. DST gaps resolve forward. */
export function localToUtc(isoDate: string, time: string, tz: string): Date {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return DateTime.fromISO(isoDate, { zone: tz }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toUTC().toJSDate();
}

/** Start of the week (inclusive) containing isoDate. weekStartsOn: 0 = Sunday. */
export function startOfWeek(isoDate: string, weekStartsOn: number): string {
  const d = DateTime.fromISO(isoDate, { zone: 'utc' });
  const dow = d.weekday % 7; // luxon: Mon=1..Sun=7 → Sun=0
  const diff = (dow - weekStartsOn + 7) % 7;
  return d.minus({ days: diff }).toISODate()!;
}

export function startOfMonth(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).startOf('month').toISODate()!;
}

export function endOfMonth(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: 'utc' }).endOf('month').toISODate()!;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return DateTime.fromISO(toIso, { zone: 'utc' }).diff(DateTime.fromISO(fromIso, { zone: 'utc' }), 'days').days;
}
