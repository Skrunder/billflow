import { z } from 'zod';
import { MONEY_RE } from './money.js';
import { MAX_REMINDER_MINUTES } from './reminders.js';
import { ISO_DATE_RE, TIME_RE, isValidIsoDate, isValidTimezone } from './time.js';

/**
 * Input validation shared by the server API and the Android app's local
 * engine, so both accept and reject exactly the same data.
 */

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });

export const isoDate = z.string().regex(ISO_DATE_RE, 'Expected YYYY-MM-DD').refine(isValidIsoDate, 'Invalid date');

export const timeOfDay = z.string().regex(TIME_RE, 'Expected HH:mm (24h)');

export const timezoneName = z.string().max(64).refine(isValidTimezone, 'Unknown timezone');

export const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => MONEY_RE.test(v), 'Expected an amount with up to 2 decimals')
  .refine((v) => Number(v) >= 0, 'Amount cannot be negative');

export const reminderOffsets = z
  .array(z.number().int().min(0).max(MAX_REMINDER_MINUTES))
  .max(10)
  .transform((a) => [...new Set(a)].sort((x, y) => y - x));

export const trimmed = (max: number) => z.string().trim().max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const recurrenceInput = z
  .object({
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    endDate: isoDate.nullish(),
    count: z.number().int().min(1).max(1000).nullish(),
  })
  .nullish();

export type RecurrenceInput = z.infer<typeof recurrenceInput>;

/** UTF-8 byte length without relying on Node's Buffer (works in browsers too). */
export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => utf8Length(p) <= 72, 'Password must be at most 72 bytes');

export const email = z.string().trim().toLowerCase().email().max(254);

export const dateRangeQuery = z
  .object({ start: isoDate, end: isoDate })
  .refine((q) => q.start <= q.end, 'start must be before end');

// ─────────────────────────────────────────────────── entities ──

export const billInput = z
  .object({
    name: trimmed(120).min(1),
    description: optionalText(1000),
    notes: optionalText(5000),
    amount: money,
    amountIsEstimate: z.boolean().default(false),
    categoryId: z.string().uuid().nullish(),
    paymentMethod: z.enum(['MANUAL', 'AUTOPAY', 'SCHEDULED_AUTOPAY']).default('MANUAL'),
    scheduledPayDaysBefore: z.number().int().min(0).max(60).nullish(),
    startDate: isoDate,
    dueTime: timeOfDay.nullish(),
    recurrence: recurrenceInput,
    reminderOffsets: reminderOffsets.optional(),
  })
  .refine((b) => b.paymentMethod !== 'SCHEDULED_AUTOPAY' || b.scheduledPayDaysBefore != null, {
    message: 'scheduledPayDaysBefore is required for scheduled auto-pay',
    path: ['scheduledPayDaysBefore'],
  })
  .refine((b) => !b.recurrence?.endDate || b.recurrence.endDate >= b.startDate, {
    message: 'Recurrence end date must be on or after the start date',
    path: ['recurrence', 'endDate'],
  });

export type BillInputParsed = z.infer<typeof billInput>;

export const eventInput = z
  .object({
    title: trimmed(120).min(1),
    description: optionalText(1000),
    notes: optionalText(5000),
    location: optionalText(200),
    categoryId: z.string().uuid().nullish(),
    startDate: isoDate,
    startTime: timeOfDay.nullish(),
    endTime: timeOfDay.nullish(),
    recurrence: recurrenceInput,
    reminderOffsets: reminderOffsets.optional(),
  })
  .refine((e) => !e.endTime || e.startTime, { message: 'An end time needs a start time', path: ['endTime'] })
  .refine((e) => !e.recurrence?.endDate || e.recurrence.endDate >= e.startDate, {
    message: 'Recurrence end date must be on or after the start date',
    path: ['recurrence', 'endDate'],
  });

export type EventInputParsed = z.infer<typeof eventInput>;

export const CALENDAR_VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listMonth'] as const;

export const settingsInput = z
  .object({
    timezone: timezoneName,
    theme: z.enum(['SYSTEM', 'LIGHT', 'DARK']),
    weekStartsOn: z.number().int().min(0).max(6),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code'),
    locale: z
      .string()
      .min(2)
      .max(35)
      .refine((l) => {
        try {
          return Intl.NumberFormat.supportedLocalesOf([l]).length > 0;
        } catch {
          return false;
        }
      }, 'Unsupported locale'),
    timeFormat: z.enum(['12h', '24h']),
    defaultCalendarView: z.enum(CALENDAR_VIEWS),
    defaultBillReminders: reminderOffsets,
    defaultEventReminders: reminderOffsets,
    allDayReminderTime: timeOfDay,
    autoCompleteAutopay: z.boolean(),
    inAppNotifications: z.boolean(),
    emailNotifications: z.boolean(),
    pushNotifications: z.boolean(),
  })
  .partial();

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #4f46e5');

export const categoryCreateInput = z.object({
  name: trimmed(60).min(1),
  type: z.enum(['BILL', 'EVENT']),
  color: hexColor.default('#6366f1'),
  icon: trimmed(40).nullish(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export const categoryUpdateInput = categoryCreateInput.omit({ type: true }).partial();
