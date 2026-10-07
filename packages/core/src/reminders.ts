import { DateTime } from 'luxon';
import { formatMoney } from './format.js';
import type { PaymentMethod, TimeFormat } from './types.js';

/**
 * Reminder rules shared by the server (email / push / in-app) and the Android
 * app (on-device notifications).
 */

/** Longest allowed reminder lead time: 30 days, in minutes. */
export const MAX_REMINDER_MINUTES = 30 * 24 * 60;

/** "At the time" reminders are still delivered if we are at most this late. */
export const LATE_GRACE_MS = 60 * 60 * 1000;

export interface ReminderLocale {
  timezone: string;
  locale: string;
  currency: string;
  timeFormat: TimeFormat;
}

/** When the reminder with this offset should fire. */
export function reminderTime(at: Date, offsetMinutes: number): Date {
  return new Date(at.getTime() - offsetMinutes * 60_000);
}

/**
 * Which offsets are due at `now`, and which single one should actually be
 * delivered. When several became due at once (an item created late, or after
 * downtime) only the most recent one (`deliver`) is sent; the rest are
 * recorded as skipped so they never fire later.
 */
export function selectDueReminders(at: Date, offsets: number[], now: Date): { due: number[]; deliver: number | null } {
  const due = offsets.filter((o) => reminderTime(at, o).getTime() <= now.getTime());
  return { due, deliver: due.length ? Math.min(...due) : null };
}

/** Real lead time in minutes (stays truthful when a reminder is delivered late). */
export function minutesUntil(at: Date, now: Date, offsetMinutes: number): number {
  const sendAt = Math.max(reminderTime(at, offsetMinutes).getTime(), now.getTime());
  return Math.max(0, Math.round((at.getTime() - sendAt) / 60_000));
}

/** "now", "in 15 minutes", "in 2 hours", "tomorrow", "in 3 days". */
export function relativeLead(minutes: number): string {
  if (minutes === 0) return 'now';
  if (minutes < 60) return `in ${minutes} minutes`;
  if (minutes < 1440) {
    const h = Math.round(minutes / 60);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(minutes / 1440);
  return d === 1 ? 'tomorrow' : `in ${d} days`;
}

/** "Wed, Oct 15" or "Wed, Oct 15 at 5:00 PM" in the user's timezone. */
export function whenText(at: Date, allDay: boolean, s: Pick<ReminderLocale, 'timezone' | 'locale' | 'timeFormat'>): string {
  const dt = DateTime.fromJSDate(at).setZone(s.timezone).setLocale(s.locale);
  const day = dt.toFormat('ccc, LLL d');
  if (allDay) return day;
  return `${day} at ${dt.toFormat(s.timeFormat === '24h' ? 'HH:mm' : 'h:mm a')}`;
}

export function billReminderText(
  bill: { name: string; amount: string; dueAt: Date; allDay: boolean; paymentMethod: PaymentMethod },
  offsetMinutes: number,
  now: Date,
  s: ReminderLocale,
): { title: string; body: string } {
  return {
    title: `${bill.name} is due ${relativeLead(minutesUntil(bill.dueAt, now, offsetMinutes))}`,
    body: `${formatMoney(bill.amount, s.currency, s.locale)} due ${whenText(bill.dueAt, bill.allDay, s)}${
      bill.paymentMethod !== 'MANUAL' ? ' (auto-pay)' : ''
    }`,
  };
}

export function eventReminderText(
  event: { title: string; startAt: Date; allDay: boolean; location: string | null },
  offsetMinutes: number,
  now: Date,
  s: ReminderLocale,
): { title: string; body: string } {
  return {
    title: offsetMinutes === 0 ? event.title : `${event.title} ${relativeLead(minutesUntil(event.startAt, now, offsetMinutes))}`,
    body: `${whenText(event.startAt, event.allDay, s)}${event.location ? ` · ${event.location}` : ''}`,
  };
}
