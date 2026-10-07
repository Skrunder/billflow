import type { z, ZodTypeAny } from 'zod';

/**
 * Validation schemas live in @skr/core so the server and the Android app
 * accept exactly the same input. Re-exported here for the route modules.
 */
export {
  billInput,
  categoryCreateInput,
  categoryUpdateInput,
  dateRangeQuery,
  email,
  eventInput,
  hexColor,
  idParams,
  isoDate,
  MAX_REMINDER_MINUTES,
  money,
  optionalText,
  password,
  recurrenceInput,
  reminderOffsets,
  settingsInput,
  timeOfDay,
  timezoneName,
  trimmed,
  uuid,
  type BillInputParsed,
  type EventInputParsed,
  type RecurrenceInput,
} from '@skr/core';

/** Parse untrusted input; ZodErrors are turned into 400 responses by the error handler. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}
