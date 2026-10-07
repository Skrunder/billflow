import { expandDates, type RecurrenceSpec } from './recurrence.js';
import { addDays, localToUtc } from './time.js';
import type { PaymentMethod } from './types.js';

/**
 * Occurrence scheduling rules shared by every engine that materialises
 * occurrences (the server today, the Android app's local database next).
 * Pure functions only — storage is the caller's business.
 */

/** How far back a brand-new recurring template is back-filled (days). */
export const BACKFILL_DAYS = 31;

/** Default number of days ahead that recurring occurrences are materialised. */
export const DEFAULT_HORIZON_DAYS = 400;

export interface ZoneSettings {
  timezone: string;
  /** Local HH:mm used for items without their own time. */
  allDayReminderTime: string;
}

export interface BillPayment {
  paymentMethod: PaymentMethod;
  scheduledPayDaysBefore: number | null;
}

export interface BillInstants {
  /** UTC instant the bill is due (drives reminders). */
  dueAt: Date;
  /** Local day auto-pay runs, or null for manual bills. */
  scheduledPayDate: string | null;
  /** UTC instant auto-pay completes the occurrence, or null for manual bills. */
  autopayAt: Date | null;
}

/** Derives the UTC instants of one bill occurrence from its local date/time. */
export function billInstants(
  dueDate: string,
  dueTime: string | null,
  bill: BillPayment,
  settings: ZoneSettings,
): BillInstants {
  const time = dueTime ?? settings.allDayReminderTime;
  const dueAt = localToUtc(dueDate, time, settings.timezone);
  if (bill.paymentMethod === 'MANUAL') return { dueAt, scheduledPayDate: null, autopayAt: null };
  const payDate =
    bill.paymentMethod === 'SCHEDULED_AUTOPAY' ? addDays(dueDate, -(bill.scheduledPayDaysBefore ?? 0)) : dueDate;
  return { dueAt, scheduledPayDate: payDate, autopayAt: localToUtc(payDate, time, settings.timezone) };
}

/** Auto-pay instant for an existing occurrence (after a timezone change). */
export function autopayInstant(
  scheduledPayDate: string | null,
  dueTime: string | null,
  paymentMethod: PaymentMethod,
  settings: ZoneSettings,
): Date | null {
  if (paymentMethod === 'MANUAL' || !scheduledPayDate) return null;
  return localToUtc(scheduledPayDate, dueTime ?? settings.allDayReminderTime, settings.timezone);
}

/** Derives the UTC start/end of one event occurrence. */
export function eventInstants(
  date: string,
  startTime: string | null,
  endTime: string | null,
  settings: ZoneSettings,
): { startAt: Date; endAt: Date | null } {
  const startAt = localToUtc(date, startTime ?? settings.allDayReminderTime, settings.timezone);
  let endAt: Date | null = null;
  if (startTime && endTime) {
    // An end time earlier than the start time means the event ends the next day.
    const endDate = endTime <= startTime ? addDays(date, 1) : date;
    endAt = localToUtc(endDate, endTime, settings.timezone);
  }
  return { startAt, endAt };
}

export function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

export function horizonDate(today: string, horizonDays: number = DEFAULT_HORIZON_DAYS): string {
  return addDays(today, horizonDays);
}

/**
 * Date range to materialise when a template is first created.
 * One-time: just its date. Recurring: from the start (but at most
 * BACKFILL_DAYS in the past) to the horizon.
 */
export function initialGenerationRange(
  startDate: string,
  recurring: boolean,
  today: string,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): { from: string; to: string } {
  if (!recurring) return { from: startDate, to: startDate };
  return { from: maxIsoDate(startDate, addDays(today, -BACKFILL_DAYS)), to: horizonDate(today, horizonDays) };
}

/** Range re-applied after a recurring template's schedule changes (never the past). */
export function regenerationRange(
  startDate: string,
  today: string,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): { from: string; to: string } {
  return { from: maxIsoDate(startDate, today), to: horizonDate(today, horizonDays) };
}

/**
 * Schedule slots a recurring template should have from `today` on.
 * Archived (ended) series want nothing.
 */
export function wantedSlots(
  startDate: string,
  spec: RecurrenceSpec | null,
  isArchived: boolean,
  today: string,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): string[] {
  if (isArchived) return [];
  const { from, to } = regenerationRange(startDate, today, horizonDays);
  return expandDates(startDate, spec, from, to);
}

/**
 * Decides what happens to *replaceable* occurrences (untouched, not past)
 * when a schedule changes. Occurrences with any history must never be passed
 * in — they are never reconciled.
 *   keep    → slot still scheduled: update in place (id and reminders survive)
 *   stale   → slot no longer scheduled: remove
 *   missing → newly scheduled slots: insert
 */
export function planReconcile<T>(
  replaceable: T[],
  slotOf: (item: T) => string,
  wanted: string[],
): { keep: T[]; stale: T[]; missing: string[] } {
  const wantedSet = new Set(wanted);
  const keep: T[] = [];
  const stale: T[] = [];
  const present = new Set<string>();
  for (const item of replaceable) {
    const slot = slotOf(item);
    if (wantedSet.has(slot)) {
      keep.push(item);
      present.add(slot);
    } else {
      stale.push(item);
    }
  }
  return { keep, stale, missing: wanted.filter((d) => !present.has(d)) };
}
