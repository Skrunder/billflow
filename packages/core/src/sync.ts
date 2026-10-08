import { z } from 'zod';
import { MAX_REMINDER_MINUTES } from './reminders.js';
import { isoDate, money, timeOfDay, timezoneName, uuid } from './schemas.js';

/**
 * Sync between the Android app and the server: the wire format, validation
 * and the conflict rules. Shared so both sides merge identically.
 *
 * Records are whole rows (not API DTOs). Calendar dates are YYYY-MM-DD,
 * instants ISO-8601 UTC, money decimal strings.
 *
 * Conflict rules (see docs/ANDROID_PLAN.md):
 *   - last writer wins per record, by updatedAt (ties keep the stored copy)
 *   - occurrence *status* (paid / skipped / cancelled / reopened) is decided
 *     separately, by statusChangedAt, so an edit made elsewhere can never undo
 *     a completion; only a later explicit status change (e.g. reopen) can
 *   - once an occurrence is individually modified it stays modified
 *   - deleting a template or category wins over edits to it
 */

export const SYNC_ENTITIES = ['categories', 'bills', 'events', 'billOccurrences', 'eventOccurrences', 'auditLogs'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];
/** Entities that can be deleted (audit history is append-only). Parents first. */
export const DELETABLE_ENTITIES = ['categories', 'bills', 'events', 'billOccurrences', 'eventOccurrences'] as const;
export type DeletableEntity = (typeof DELETABLE_ENTITIES)[number];

/** Most records accepted per entity in one push; clients send bigger changes in several batches. */
export const MAX_PUSH_RECORDS = 2000;

const instant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
const text = (max: number) => z.string().max(max).nullable();
const offsets = z.array(z.number().int().min(0).max(MAX_REMINDER_MINUTES)).max(10);
const weekdays = z.array(z.number().int().min(0).max(6)).max(7);
const frequency = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).nullable();
/** Optional on pushed records: the updatedAt of the server copy this edit was based on (conflict reporting). */
const base = { baseUpdatedAt: instant.nullish() };

export const syncSettings = z.object({
  timezone: timezoneName,
  theme: z.enum(['SYSTEM', 'LIGHT', 'DARK']),
  weekStartsOn: z.number().int().min(0).max(6),
  currency: z.string().regex(/^[A-Z]{3}$/),
  locale: z.string().min(2).max(35),
  timeFormat: z.enum(['12h', '24h']),
  defaultCalendarView: z.enum(['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listMonth']),
  defaultBillReminders: offsets,
  defaultEventReminders: offsets,
  allDayReminderTime: timeOfDay,
  autoCompleteAutopay: z.boolean(),
  updatedAt: instant,
  ...base,
});
// Notification channel switches are per device (on the phone "push" means its
// own notifications), so they are deliberately not synced.

export const syncCategory = z.object({
  id: uuid,
  type: z.enum(['BILL', 'EVENT']),
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: text(40),
  sortOrder: z.number().int().min(0).max(100_000),
  createdAt: instant,
  updatedAt: instant,
  ...base,
});

const template = {
  id: uuid,
  categoryId: uuid.nullable(),
  description: text(1000),
  notes: text(5000),
  startDate: isoDate,
  recurrenceFrequency: frequency,
  recurrenceInterval: z.number().int().min(1).max(365),
  recurrenceByWeekday: weekdays,
  recurrenceEndDate: isoDate.nullable(),
  recurrenceCount: z.number().int().min(1).max(1000).nullable(),
  reminderOffsets: offsets,
  generatedUntil: isoDate.nullable(),
  isArchived: z.boolean(),
  createdAt: instant,
  updatedAt: instant,
  ...base,
};

export const syncBill = z.object({
  ...template,
  name: z.string().trim().min(1).max(120),
  amount: money,
  // Optional: devices and servers from before 1.4.0 don't send it (see fillMissing).
  amountIsEstimate: z.boolean().optional(),
  paymentMethod: z.enum(['MANUAL', 'AUTOPAY', 'SCHEDULED_AUTOPAY']),
  scheduledPayDaysBefore: z.number().int().min(0).max(60).nullable(),
  dueTime: timeOfDay.nullable(),
});

export const syncEvent = z.object({
  ...template,
  title: z.string().trim().min(1).max(120),
  location: text(200),
  startTime: timeOfDay.nullable(),
  endTime: timeOfDay.nullable(),
});

export const syncBillOccurrence = z.object({
  id: uuid,
  billId: uuid,
  originalDueDate: isoDate,
  dueDate: isoDate,
  dueTime: timeOfDay.nullable(),
  dueAt: instant,
  amount: money,
  amountIsEstimate: z.boolean().optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'SKIPPED']),
  completedAt: instant.nullable(),
  amountPaid: money.nullable(),
  confirmationNumber: text(120),
  notes: text(5000),
  scheduledPayDate: isoDate.nullable(),
  autopayAt: instant.nullable(),
  isModified: z.boolean(),
  statusChangedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
  ...base,
});

export const syncEventOccurrence = z.object({
  id: uuid,
  eventId: uuid,
  originalDate: isoDate,
  eventDate: isoDate,
  startTime: timeOfDay.nullable(),
  endTime: timeOfDay.nullable(),
  startAt: instant,
  endAt: instant.nullable(),
  status: z.enum(['UPCOMING', 'COMPLETED', 'CANCELLED']),
  completedAt: instant.nullable(),
  cancelledAt: instant.nullable(),
  notes: text(5000),
  isModified: z.boolean(),
  statusChangedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
  ...base,
});

export const syncAuditLog = z.object({
  id: uuid,
  actorType: z.enum(['USER', 'SYSTEM']),
  entityType: z.enum(['SETTINGS', 'USER', 'CATEGORY', 'BILL', 'BILL_OCCURRENCE', 'EVENT', 'EVENT_OCCURRENCE']),
  entityId: z.string().min(1).max(64),
  action: z.string().min(1).max(64),
  changes: z.unknown().nullable(),
  createdAt: instant,
});

export type SyncSettings = z.infer<typeof syncSettings>;
export type SyncCategory = z.infer<typeof syncCategory>;
export type SyncBill = z.infer<typeof syncBill>;
export type SyncEvent = z.infer<typeof syncEvent>;
export type SyncBillOccurrence = z.infer<typeof syncBillOccurrence>;
export type SyncEventOccurrence = z.infer<typeof syncEventOccurrence>;
export type SyncAuditLog = z.infer<typeof syncAuditLog>;

export interface SyncRecords {
  categories: SyncCategory;
  bills: SyncBill;
  events: SyncEvent;
  billOccurrences: SyncBillOccurrence;
  eventOccurrences: SyncEventOccurrence;
  auditLogs: SyncAuditLog;
}

export type SyncChanges = { settings: SyncSettings | null } & { [E in SyncEntity]: SyncRecords[E][] };

export const syncDelete = z.object({ entity: z.enum(DELETABLE_ENTITIES), id: uuid });
export type SyncDelete = z.infer<typeof syncDelete>;

const records = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(MAX_PUSH_RECORDS).default([]);

export const pushRequest = z.object({
  deviceId: uuid,
  /** Random per batch; re-sending the same batch (e.g. after a timeout) returns the first result. */
  batchId: uuid,
  changes: z
    .object({
      settings: syncSettings.nullish(),
      categories: records(syncCategory),
      bills: records(syncBill),
      events: records(syncEvent),
      billOccurrences: records(syncBillOccurrence),
      eventOccurrences: records(syncEventOccurrence),
      auditLogs: records(syncAuditLog),
    })
    .default({}),
  deletes: z
    .array(syncDelete.extend({ deletedAt: instant }))
    .max(MAX_PUSH_RECORDS)
    .default([]),
});
export type PushRequest = z.input<typeof pushRequest>;

export type AdoptRecord = { [E in SyncEntity]: { entity: E; record: SyncRecords[E] } }[SyncEntity] | { entity: 'settings'; record: SyncSettings };

export interface PushResponse {
  /** Records the server stored as sent. */
  applied: number;
  /** The server's resulting copy where it differs from what was sent: replace the local row with it. */
  adopt: AdoptRecord[];
  /** Rows the device should delete (e.g. occurrences of a template deleted elsewhere). */
  remove: SyncDelete[];
  /** Same record under another id on the server: rename the local row (and references to it). */
  remapped: { entity: 'categories' | 'billOccurrences' | 'eventOccurrences'; from: string; to: string }[];
  /** Number of concurrent edits that were resolved (both versions are in the audit history). */
  conflicts: number;
}

export interface PullResponse {
  changes: SyncChanges;
  deletes: SyncDelete[];
  /** Opaque; pass back as `since`. Changes may be repeated across pulls, so applying must be idempotent. */
  cursor: string;
  /** More changes are waiting: pull again with the new cursor. */
  hasMore: boolean;
  serverTime: string;
}

// ─────────────────────────────────────────────────── merging ──

/** Fields decided by statusChangedAt rather than updatedAt. */
export const BILL_STATUS_FIELDS = ['status', 'completedAt', 'amountPaid', 'confirmationNumber', 'autopayAt', 'statusChangedAt'] as const;
export const EVENT_STATUS_FIELDS = ['status', 'completedAt', 'cancelledAt', 'statusChangedAt'] as const;

export interface MergeResult<T> {
  record: T;
  /** Which copy the result equals ('merged' = parts of both). */
  winner: 'existing' | 'incoming' | 'merged';
  /**
   * Fields where the two copies differed: the value kept and the one replaced.
   * Whether that is a real conflict depends on whether both sides changed the
   * record (the server checks the device's baseUpdatedAt).
   */
  dropped: Record<string, { kept: unknown; discarded: unknown }>;
}

const later = (a: string | null | undefined, b: string | null | undefined) => (a ?? '') > (b ?? '');
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function finish<T extends Record<string, unknown>>(existing: T, incoming: T, record: T, keys: string[]): MergeResult<T> {
  const dropped: MergeResult<T>['dropped'] = {};
  for (const k of keys) {
    if (k === 'updatedAt' || k === 'createdAt' || k === 'baseUpdatedAt' || k === 'isModified') continue;
    const loser = same(record[k], existing[k]) ? incoming[k] : existing[k];
    if (!same(record[k], loser)) dropped[k] = { kept: record[k] ?? null, discarded: loser ?? null };
  }
  const isExisting = keys.every((k) => same(record[k], existing[k]));
  const isIncoming = keys.every((k) => same(record[k], incoming[k]));
  return { record, winner: isExisting ? 'existing' : isIncoming ? 'incoming' : 'merged', dropped };
}

/**
 * A field the other side doesn't send (it runs an older version without it)
 * keeps the stored value instead of being cleared.
 */
export function fillMissing<T extends object>(existing: T, incoming: T): T {
  const out = { ...incoming } as Record<string, unknown>;
  for (const [k, v] of Object.entries(existing)) if (out[k] === undefined) out[k] = v;
  return out as T;
}

/** Last writer wins by updatedAt; on a tie the stored copy stays. */
export function mergeRecord<T extends { updatedAt: string }>(existing: T, newer: T): MergeResult<T> {
  const incoming = fillMissing(existing, newer);
  const keys = Object.keys(existing).filter((k) => k !== 'baseUpdatedAt');
  const record = { ...(later(incoming.updatedAt, existing.updatedAt) ? incoming : existing) } as Record<string, unknown>;
  delete record.baseUpdatedAt;
  return finish(existing as T & Record<string, unknown>, incoming as T & Record<string, unknown>, record as T & Record<string, unknown>, keys) as MergeResult<T>;
}

/**
 * Occurrence merge: other fields by updatedAt, status fields by
 * statusChangedAt (so a completion is never lost to a plain edit),
 * isModified sticky, updatedAt the later of the two.
 */
export function mergeOccurrence<T extends { updatedAt: string; statusChangedAt: string | null; isModified: boolean }>(
  existing: T,
  sent: T,
  statusFields: readonly string[],
): MergeResult<T> {
  const incoming = fillMissing(existing, sent);
  const keys = Object.keys(existing).filter((k) => k !== 'baseUpdatedAt');
  const newer = later(incoming.updatedAt, existing.updatedAt) ? incoming : existing;
  const record = { ...newer } as Record<string, unknown>;
  delete record.baseUpdatedAt;
  const statusFrom = later(incoming.statusChangedAt, existing.statusChangedAt)
    ? incoming
    : later(existing.statusChangedAt, incoming.statusChangedAt)
      ? existing
      : newer;
  for (const f of statusFields) record[f] = (statusFrom as Record<string, unknown>)[f];
  record.isModified = existing.isModified || incoming.isModified;
  record.updatedAt = later(incoming.updatedAt, existing.updatedAt) ? incoming.updatedAt : existing.updatedAt;
  const result = finish(existing as T & Record<string, unknown>, incoming as T & Record<string, unknown>, record as T & Record<string, unknown>, keys);
  // A side that never changed the status only carries the old status; that is not a decision being overruled.
  const statusLoser = statusFrom === incoming ? existing : incoming;
  if (!statusLoser.statusChangedAt) for (const f of statusFields) delete result.dropped[f];
  return result as MergeResult<T>;
}
