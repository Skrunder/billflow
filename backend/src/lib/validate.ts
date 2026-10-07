import { z, type ZodTypeAny } from 'zod';
import { ISO_DATE_RE, TIME_RE, isValidIsoDate, isValidTimezone } from './time';

/** Parse untrusted input; ZodErrors are turned into 400 responses by the error handler. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });

export const isoDate = z
  .string()
  .regex(ISO_DATE_RE, 'Expected YYYY-MM-DD')
  .refine(isValidIsoDate, 'Invalid date');

export const timeOfDay = z.string().regex(TIME_RE, 'Expected HH:mm (24h)');

export const timezoneName = z.string().max(64).refine(isValidTimezone, 'Unknown timezone');

export const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d{1,10}(\.\d{1,2})?$/.test(v), 'Expected an amount with up to 2 decimals')
  .refine((v) => Number(v) >= 0, 'Amount cannot be negative');

/** Max reminder lead time: 30 days. */
export const MAX_REMINDER_MINUTES = 30 * 24 * 60;

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

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes');

export const email = z.string().trim().toLowerCase().email().max(254);

export const dateRangeQuery = z
  .object({ start: isoDate, end: isoDate })
  .refine((q) => q.start <= q.end, 'start must be before end');
