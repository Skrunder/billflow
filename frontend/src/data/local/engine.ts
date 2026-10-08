import {
  addDays,
  billInput,
  billInstants,
  billReminderText,
  categoryCreateInput,
  categoryUpdateInput,
  daysBetween,
  DEFAULT_CATEGORIES,
  DEFAULT_HORIZON_DAYS,
  endOfMonth,
  eventInput,
  eventInstants,
  eventReminderText,
  expandDates,
  fromCents,
  initialGenerationRange,
  isValidTimezone,
  LATE_GRACE_MS,
  MAX_REMINDER_MINUTES,
  occurrenceId,
  planReconcile,
  randomUuid,
  regenerationRange,
  reminderTime,
  selectDueReminders,
  settingsInput,
  startOfMonth,
  startOfWeek,
  summarizeBills,
  toCents,
  todayInZone,
  wantedSlots,
  autopayInstant,
  effectiveBillStatus,
  type AppNotification,
  type BillInputParsed,
  type CalendarItem,
  type EventInputParsed,
  type HistoryEntry,
  type HistoryKind,
  type RecurrenceInput,
  type User,
} from '@skr/core';
import { z, ZodError } from 'zod';
import { ApiError } from '../../api/client';
import type { DataRepository } from '../repository';
import type { SqlDriver, SqlRow, SqlValue } from './driver';
import {
  diff,
  fromRow,
  serializeBill,
  serializeBillOccurrence,
  serializeCategory,
  serializeEvent,
  serializeEventOccurrence,
  specOf,
  toSnake,
  toSqlValue,
  type BillModel,
  type BillOccurrenceModel,
  type CategoryModel,
  type EventModel,
  type EventOccurrenceModel,
  type SettingsModel,
} from './models';
import { migrate, SCHEMA_VERSION } from './schema';
import { createSyncStore, type SyncStore } from './sync-store';

/**
 * LocalRepository — the full app engine running on the device's own SQLite
 * database. It implements DataRepository with the same behaviour as the
 * server API (backend/src/modules/*), using the same shared rules from
 * @skr/core for scheduling, reconciliation, statuses, reminders, totals and
 * validation.
 *
 * Integrity rules (identical to the server):
 *   - templates and occurrences are separate rows; occurrence ids are
 *     deterministic (UUIDv5 of template + schedule slot)
 *   - every status change touches exactly one occurrence row and writes an
 *     audit entry for that occurrence
 *   - template edits only reconcile untouched, not-past occurrences
 *   - OVERDUE is derived; events never count toward money totals
 * All public calls are serialised and run inside one SQL transaction.
 */

export interface LocalRepositoryOptions {
  /** Override "now" (tests). */
  clock?: () => Date;
  horizonDays?: number;
  /** Used only when the database is created for the first time. */
  timezone?: string;
  locale?: string;
  displayName?: string;
  /** Called after any call that changed data has committed (e.g. to reschedule phone reminders). */
  onChange?: () => void;
}

/** A reminder that will become due later; the Android app schedules these as system notifications. */
export interface UpcomingReminder {
  /** Stable per occurrence and offset: `${occurrenceId}:${offsetMinutes}`. */
  key: string;
  at: string;
  title: string;
  body: string;
  url: string;
}

/** Full copy of the on-device database, written to a file by "Back up" in Settings. */
export interface LocalBackup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  createdAt: string;
  tables: Record<string, SqlRow[]>;
}

export const BACKUP_FORMAT = 'skr-bill-calendar-backup@1';

/** Restored parent-first (foreign keys), deleted in reverse. `meta` is never restored. */
const BACKUP_TABLES = [
  'profile',
  'settings',
  'categories',
  'bills',
  'bill_occurrences',
  'events',
  'event_occurrences',
  'notifications',
  'audit_logs',
] as const;
/** Server-sync bookkeeping: never in backups (it holds the server connection). */
const SYNC_TABLES = ['outbox', 'sync_base', 'sync_state'] as const;

export type LocalRepository = DataRepository & {
  /** Auto-pay, horizon extension and due reminders. Runs automatically about once a minute. */
  runMaintenance(): Promise<void>;
  /** The next reminders after "now", soonest first (pending bills and upcoming events only). */
  getUpcomingReminders(options?: { limit?: number; days?: number }): Promise<UpcomingReminder[]>;
  /** Lossless copy of every table (unlike exportData, which is the server's readable format). */
  createBackup(): Promise<LocalBackup>;
  /** Replaces everything on this device with a backup. All or nothing. */
  restoreBackup(backup: unknown): Promise<void>;
  /** Server sync storage (used by src/sync/client.ts). Each call is one transaction. */
  sync: SyncStore;
  /** Runs `fn` after every call that changed data (like the onChange option). Returns an unsubscribe function. */
  subscribeChanges(fn: () => void): () => void;
  close(): Promise<void>;
};

type EntityType = 'SETTINGS' | 'USER' | 'CATEGORY' | 'BILL' | 'BILL_OCCURRENCE' | 'EVENT' | 'EVENT_OCCURRENCE';

const HISTORY_ENTITY: Record<HistoryKind, EntityType> = {
  bills: 'BILL',
  'bill-occurrences': 'BILL_OCCURRENCE',
  events: 'EVENT',
  'event-occurrences': 'EVENT_OCCURRENCE',
};

const MAINTENANCE_INTERVAL_MS = 60_000;
const MAX_CALENDAR_DAYS = 400;

const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`);
const badRequest = (message: string) => new ApiError(400, 'BAD_REQUEST', message);

/** Validate with a shared schema; failures look exactly like the server's 400s. */
function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Invalid request',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    throw err;
  }
}

const money = (v: string | number) => fromCents(toCents(v));
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const BILL_OCC_SELECT = `
  SELECT o.* FROM bill_occurrences o JOIN bills b ON b.id = o.bill_id`;
const EVENT_OCC_SELECT = `
  SELECT o.* FROM event_occurrences o JOIN events e ON e.id = o.event_id`;

export async function createLocalRepository(db: SqlDriver, options: LocalRepositoryOptions = {}): Promise<LocalRepository> {
  const now = () => options.clock?.() ?? new Date();
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  let lastMaintenance = 0;
  const changeListeners = new Set<() => void>(options.onChange ? [options.onChange] : []);

  // ─────────────────────────────────────────────── low-level helpers ──

  const all = <T>(sql: string, params: SqlValue[] = []) => db.all(sql, params).then((rows) => rows.map((r) => fromRow<T>(r)));
  const one = async <T>(sql: string, params: SqlValue[] = []) => (await all<T>(sql, params))[0] ?? null;
  let changed = false;
  const run = (sql: string, params: SqlValue[] = []) => {
    changed = true;
    return db.run(sql, params);
  };

  async function insert(table: string, model: object) {
    const entries = Object.entries(model);
    await run(
      `INSERT INTO ${table} (${entries.map(([k]) => toSnake(k)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`,
      entries.map(([k, v]) => toSqlValue(k, v)),
    );
  }

  async function update(table: string, id: string, patch: object) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    await run(
      `UPDATE ${table} SET ${entries.map(([k]) => `${toSnake(k)} = ?`).join(', ')} WHERE id = ?`,
      [...entries.map(([k, v]) => toSqlValue(k, v)), id],
    );
  }

  async function audit(entityType: EntityType, entityId: string, action: string, changes?: unknown, actorType: 'USER' | 'SYSTEM' = 'USER') {
    await insert('audit_logs', {
      id: randomUuid(),
      actorType,
      entityType,
      entityId,
      action,
      changes: changes === undefined ? null : JSON.stringify(changes),
      createdAt: now().toISOString(),
    });
  }


  // Serialise every public call and wrap it in one transaction.
  let queue: Promise<unknown> = Promise.resolve();
  function op<T>(fn: () => Promise<T>, maintain = true): Promise<T> {
    const result = queue.then(async () => {
      await db.exec('BEGIN');
      changed = false;
      try {
        if (maintain && now().getTime() - lastMaintenance >= MAINTENANCE_INTERVAL_MS) await maintenance();
        const value = await fn();
        await db.exec('COMMIT');
        db.afterWrite?.();
        if (changed) for (const fn of changeListeners) fn();
        return value;
      } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
      }
    });
    queue = result.catch(() => undefined);
    return result;
  }

  // ────────────────────────────────────────────── settings & profile ──

  async function getSettingsModel(): Promise<SettingsModel> {
    const s = await one<SettingsModel & { id: number }>('SELECT * FROM settings WHERE id = 1');
    if (!s) throw new Error('Local database is not initialised');
    const { id: _id, ...rest } = s;
    return rest;
  }

  async function today() {
    return todayInZone((await getSettingsModel()).timezone, now());
  }

  async function getUser(): Promise<User> {
    const p = await one<{ id: string; email: string; displayName: string; createdAt: string }>('SELECT * FROM profile LIMIT 1');
    if (!p) throw new Error('Local database is not initialised');
    return { id: p.id, email: p.email, displayName: p.displayName, role: 'USER', emailVerified: true, createdAt: p.createdAt };
  }

  // ───────────────────────────────────────────────────── categories ──

  async function categoryById(id: string | null): Promise<CategoryModel | null> {
    return id ? one<CategoryModel>('SELECT * FROM categories WHERE id = ?', [id]) : null;
  }

  async function assertCategory(id: string | null | undefined, type: 'BILL' | 'EVENT') {
    if (!id) return;
    const c = await categoryById(id);
    if (!c || c.type !== type) throw badRequest(type === 'BILL' ? 'Unknown bill category' : 'Unknown event category');
  }

  // ───────────────────────────────────────────── template columns ──

  function recurrenceColumns(r: RecurrenceInput) {
    return {
      recurrenceFrequency: r?.frequency ?? null,
      recurrenceInterval: r?.interval ?? 1,
      recurrenceByWeekday: r?.frequency === 'WEEKLY' ? (r.byWeekday ?? []) : [],
      recurrenceEndDate: r?.endDate ?? null,
      recurrenceCount: r?.count ?? null,
    };
  }

  function billColumns(b: BillInputParsed, defaults: number[]) {
    return {
      name: b.name,
      description: b.description,
      notes: b.notes,
      amount: money(b.amount),
      categoryId: b.categoryId ?? null,
      paymentMethod: b.paymentMethod,
      scheduledPayDaysBefore: b.paymentMethod === 'SCHEDULED_AUTOPAY' ? (b.scheduledPayDaysBefore ?? 0) : null,
      startDate: b.startDate,
      dueTime: b.dueTime ?? null,
      reminderOffsets: b.reminderOffsets ?? defaults,
      ...recurrenceColumns(b.recurrence),
    };
  }

  function eventColumns(e: EventInputParsed, defaults: number[]) {
    return {
      title: e.title,
      description: e.description,
      notes: e.notes,
      location: e.location,
      categoryId: e.categoryId ?? null,
      startDate: e.startDate,
      startTime: e.startTime ?? null,
      endTime: e.startTime ? (e.endTime ?? null) : null,
      reminderOffsets: e.reminderOffsets ?? defaults,
      ...recurrenceColumns(e.recurrence),
    };
  }

  const BILL_SCHEDULE_FIELDS = [
    'startDate',
    'dueTime',
    'paymentMethod',
    'scheduledPayDaysBefore',
    'recurrenceFrequency',
    'recurrenceInterval',
    'recurrenceByWeekday',
    'recurrenceEndDate',
    'recurrenceCount',
  ];
  const EVENT_SCHEDULE_FIELDS = [
    'startDate',
    'startTime',
    'endTime',
    'recurrenceFrequency',
    'recurrenceInterval',
    'recurrenceByWeekday',
    'recurrenceEndDate',
    'recurrenceCount',
  ];

  // ──────────────────────────────────────── occurrence generation ──

  function billInstantColumns(dueDate: string, dueTime: string | null, bill: BillModel, s: SettingsModel) {
    const i = billInstants(dueDate, dueTime, bill, s);
    return { dueAt: i.dueAt.toISOString(), scheduledPayDate: i.scheduledPayDate, autopayAt: i.autopayAt?.toISOString() ?? null };
  }

  function eventInstantColumns(date: string, startTime: string | null, endTime: string | null, s: SettingsModel) {
    const i = eventInstants(date, startTime, endTime, s);
    return { startAt: i.startAt.toISOString(), endAt: i.endAt?.toISOString() ?? null };
  }

  async function insertBillOccurrences(bill: BillModel, s: SettingsModel, from: string, to: string) {
    const stamp = now().toISOString();
    for (const d of expandDates(bill.startDate, specOf(bill), from, to)) {
      const row = {
        id: occurrenceId(bill.id, d),
        billId: bill.id,
        originalDueDate: d,
        dueDate: d,
        dueTime: bill.dueTime,
        amount: bill.amount,
        ...billInstantColumns(d, bill.dueTime, bill, s),
        createdAt: stamp,
        updatedAt: stamp,
      };
      const keys = Object.keys(row);
      await run(
        `INSERT INTO bill_occurrences (${keys.map(toSnake).join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`,
        keys.map((k) => toSqlValue(k, (row as Record<string, unknown>)[k])),
      );
    }
  }

  async function insertEventOccurrences(event: EventModel, s: SettingsModel, from: string, to: string) {
    const stamp = now().toISOString();
    for (const d of expandDates(event.startDate, specOf(event), from, to)) {
      const row = {
        id: occurrenceId(event.id, d),
        eventId: event.id,
        originalDate: d,
        eventDate: d,
        startTime: event.startTime,
        endTime: event.endTime,
        ...eventInstantColumns(d, event.startTime, event.endTime, s),
        createdAt: stamp,
        updatedAt: stamp,
      };
      const keys = Object.keys(row);
      await run(
        `INSERT INTO event_occurrences (${keys.map(toSnake).join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`,
        keys.map((k) => toSqlValue(k, (row as Record<string, unknown>)[k])),
      );
    }
  }

  async function generateForNewBill(bill: BillModel, s: SettingsModel) {
    const { from, to } = initialGenerationRange(bill.startDate, Boolean(bill.recurrenceFrequency), todayInZone(s.timezone, now()), horizonDays);
    await insertBillOccurrences(bill, s, from, to);
    await update('bills', bill.id, { generatedUntil: to });
  }

  async function generateForNewEvent(event: EventModel, s: SettingsModel) {
    const { from, to } = initialGenerationRange(event.startDate, Boolean(event.recurrenceFrequency), todayInZone(s.timezone, now()), horizonDays);
    await insertEventOccurrences(event, s, from, to);
    await update('events', event.id, { generatedUntil: to });
  }

  /** Same reconciliation as the server: only untouched, not-past occurrences change. */
  async function regenerateBill(bill: BillModel, s: SettingsModel) {
    const t = todayInZone(s.timezone, now());
    const recurring = Boolean(bill.recurrenceFrequency);
    const replaceable = await all<BillOccurrenceModel>(
      `SELECT * FROM bill_occurrences WHERE bill_id = ? AND status = 'PENDING' AND is_modified = 0 ${recurring ? 'AND due_date >= ?' : ''}`,
      recurring ? [bill.id, t] : [bill.id],
    );
    const stamp = now().toISOString();

    if (!recurring) {
      const [current, ...extra] = replaceable;
      for (const o of extra) await run('DELETE FROM bill_occurrences WHERE id = ?', [o.id]);
      if (bill.isArchived) {
        if (current) await run('DELETE FROM bill_occurrences WHERE id = ?', [current.id]);
      } else if (current) {
        await update('bill_occurrences', current.id, {
          originalDueDate: bill.startDate,
          dueDate: bill.startDate,
          dueTime: bill.dueTime,
          amount: bill.amount,
          ...billInstantColumns(bill.startDate, bill.dueTime, bill, s),
          updatedAt: stamp,
        });
      } else if (!(await all('SELECT id FROM bill_occurrences WHERE bill_id = ? LIMIT 1', [bill.id])).length) {
        await insertBillOccurrences(bill, s, bill.startDate, bill.startDate);
      }
      await update('bills', bill.id, { generatedUntil: bill.startDate });
      return;
    }

    const wanted = wantedSlots(bill.startDate, specOf(bill), bill.isArchived, t, horizonDays);
    const { keep, stale } = planReconcile(replaceable, (o) => o.originalDueDate, wanted);
    for (const o of stale) await run('DELETE FROM bill_occurrences WHERE id = ?', [o.id]);
    for (const o of keep) {
      await update('bill_occurrences', o.id, {
        dueDate: o.originalDueDate,
        dueTime: bill.dueTime,
        amount: bill.amount,
        ...billInstantColumns(o.originalDueDate, bill.dueTime, bill, s),
        updatedAt: stamp,
      });
    }
    if (!bill.isArchived) {
      const { from, to } = regenerationRange(bill.startDate, t, horizonDays);
      await insertBillOccurrences(bill, s, from, to);
      await update('bills', bill.id, { generatedUntil: to });
    }
  }

  async function regenerateEvent(event: EventModel, s: SettingsModel) {
    const t = todayInZone(s.timezone, now());
    const recurring = Boolean(event.recurrenceFrequency);
    const replaceable = await all<EventOccurrenceModel>(
      `SELECT * FROM event_occurrences WHERE event_id = ? AND status = 'UPCOMING' AND is_modified = 0 ${recurring ? 'AND event_date >= ?' : ''}`,
      recurring ? [event.id, t] : [event.id],
    );
    const stamp = now().toISOString();

    if (!recurring) {
      const [current, ...extra] = replaceable;
      for (const o of extra) await run('DELETE FROM event_occurrences WHERE id = ?', [o.id]);
      if (event.isArchived) {
        if (current) await run('DELETE FROM event_occurrences WHERE id = ?', [current.id]);
      } else if (current) {
        await update('event_occurrences', current.id, {
          originalDate: event.startDate,
          eventDate: event.startDate,
          startTime: event.startTime,
          endTime: event.endTime,
          ...eventInstantColumns(event.startDate, event.startTime, event.endTime, s),
          updatedAt: stamp,
        });
      } else if (!(await all('SELECT id FROM event_occurrences WHERE event_id = ? LIMIT 1', [event.id])).length) {
        await insertEventOccurrences(event, s, event.startDate, event.startDate);
      }
      await update('events', event.id, { generatedUntil: event.startDate });
      return;
    }

    const wanted = wantedSlots(event.startDate, specOf(event), event.isArchived, t, horizonDays);
    const { keep, stale } = planReconcile(replaceable, (o) => o.originalDate, wanted);
    for (const o of stale) await run('DELETE FROM event_occurrences WHERE id = ?', [o.id]);
    for (const o of keep) {
      await update('event_occurrences', o.id, {
        eventDate: o.originalDate,
        startTime: event.startTime,
        endTime: event.endTime,
        ...eventInstantColumns(o.originalDate, event.startTime, event.endTime, s),
        updatedAt: stamp,
      });
    }
    if (!event.isArchived) {
      const { from, to } = regenerationRange(event.startDate, t, horizonDays);
      await insertEventOccurrences(event, s, from, to);
      await update('events', event.id, { generatedUntil: to });
    }
  }

  /** Materialises every active recurring series up to `until` (default: the horizon). */
  async function ensureGenerated(until?: string) {
    const s = await getSettingsModel();
    const target = until ?? addDays(todayInZone(s.timezone, now()), horizonDays);
    const bills = await all<BillModel>(
      'SELECT * FROM bills WHERE is_archived = 0 AND recurrence_frequency IS NOT NULL AND (generated_until IS NULL OR generated_until < ?)',
      [target],
    );
    for (const b of bills) {
      await insertBillOccurrences(b, s, b.generatedUntil ? addDays(b.generatedUntil, 1) : b.startDate, target);
      await update('bills', b.id, { generatedUntil: target });
    }
    const events = await all<EventModel>(
      'SELECT * FROM events WHERE is_archived = 0 AND recurrence_frequency IS NOT NULL AND (generated_until IS NULL OR generated_until < ?)',
      [target],
    );
    for (const e of events) {
      await insertEventOccurrences(e, s, e.generatedUntil ? addDays(e.generatedUntil, 1) : e.startDate, target);
      await update('events', e.id, { generatedUntil: target });
    }
  }

  /** After a timezone / all-day-time change: recompute UTC instants of actionable occurrences. */
  async function recomputeInstants(s: SettingsModel) {
    const since = addDays(todayInZone(s.timezone, now()), -2);
    const billOccs = await db.all<SqlRow>(
      `SELECT o.id, o.due_date, o.due_time, o.scheduled_pay_date, b.payment_method FROM bill_occurrences o
       JOIN bills b ON b.id = o.bill_id WHERE o.status = 'PENDING' AND o.due_date >= ?`,
      [since],
    );
    for (const r of billOccs) {
      const dueTime = (r.due_time as string | null) ?? null;
      await update('bill_occurrences', String(r.id), {
        dueAt: billInstants(String(r.due_date), dueTime, { paymentMethod: 'MANUAL', scheduledPayDaysBefore: null }, s).dueAt.toISOString(),
        autopayAt:
          autopayInstant((r.scheduled_pay_date as string | null) ?? null, dueTime, r.payment_method as BillModel['paymentMethod'], s)?.toISOString() ??
          null,
      });
    }
    const eventOccs = await all<EventOccurrenceModel>("SELECT * FROM event_occurrences WHERE status = 'UPCOMING' AND event_date >= ?", [since]);
    for (const o of eventOccs) await update('event_occurrences', o.id, eventInstantColumns(o.eventDate, o.startTime, o.endTime, s));
  }

  // ─────────────────────────────────────────────── maintenance jobs ──

  /** Auto-pay: completes due AUTOPAY / SCHEDULED_AUTOPAY occurrences one by one. */
  async function processAutopay(s: SettingsModel) {
    if (!s.autoCompleteAutopay) return;
    const due = await all<BillOccurrenceModel>(
      `SELECT o.* FROM bill_occurrences o JOIN bills b ON b.id = o.bill_id
       WHERE o.status = 'PENDING' AND o.autopay_at IS NOT NULL AND o.autopay_at <= ? AND b.payment_method <> 'MANUAL'`,
      [now().toISOString()],
    );
    for (const o of due) {
      const stamp = now().toISOString();
      await update('bill_occurrences', o.id, { status: 'COMPLETED', completedAt: o.autopayAt, amountPaid: o.amount, statusChangedAt: stamp, updatedAt: stamp });
      await audit('BILL_OCCURRENCE', o.id, 'AUTOPAY_COMPLETED', { status: { from: 'PENDING', to: 'COMPLETED' } }, 'SYSTEM');
    }
  }

  /** In-app inbox: records reminders that have become due (same rules as the server). */
  // Inbox rows use db.run, not run(): they don't change what the phone schedules,
  // so they shouldn't count as a change for onChange.
  async function planReminders(s: SettingsModel) {
    if (!s.inAppNotifications) return;
    const n = now();
    const windowStart = new Date(n.getTime() - LATE_GRACE_MS).toISOString();
    const windowEnd = new Date(n.getTime() + MAX_REMINDER_MINUTES * 60_000).toISOString();
    const locale = { timezone: s.timezone, locale: s.locale, currency: s.currency, timeFormat: s.timeFormat };
    const stamp = n.toISOString();

    const bills = await db.all<SqlRow>(
      `SELECT o.id, o.bill_id, o.due_at, o.due_time, o.amount, b.name, b.payment_method, b.reminder_offsets
       FROM bill_occurrences o JOIN bills b ON b.id = o.bill_id
       WHERE o.status = 'PENDING' AND o.due_at >= ? AND o.due_at <= ? AND b.reminder_offsets <> '[]'`,
      [windowStart, windowEnd],
    );
    for (const r of bills) {
      const at = new Date(String(r.due_at));
      const { due, deliver } = selectDueReminders(at, JSON.parse(String(r.reminder_offsets)) as number[], n);
      for (const offset of due) {
        const text = billReminderText(
          { name: String(r.name), amount: String(r.amount), dueAt: at, allDay: !r.due_time, paymentMethod: r.payment_method as BillModel['paymentMethod'] },
          offset,
          n,
          locale,
        );
        await db.run(
          `INSERT INTO notifications (id, bill_occurrence_id, offset_minutes, scheduled_for, status, title, body, url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [randomUuid(), String(r.id), offset, reminderTime(at, offset).toISOString(), offset === deliver ? 'SENT' : 'CANCELLED', text.title, text.body, `/bills/${r.bill_id}?occurrence=${r.id}`, stamp],
        );
      }
    }

    const events = await db.all<SqlRow>(
      `SELECT o.id, o.event_id, o.start_at, o.start_time, e.title, e.location, e.reminder_offsets
       FROM event_occurrences o JOIN events e ON e.id = o.event_id
       WHERE o.status = 'UPCOMING' AND o.start_at >= ? AND o.start_at <= ? AND e.reminder_offsets <> '[]'`,
      [windowStart, windowEnd],
    );
    for (const r of events) {
      const at = new Date(String(r.start_at));
      const { due, deliver } = selectDueReminders(at, JSON.parse(String(r.reminder_offsets)) as number[], n);
      for (const offset of due) {
        const text = eventReminderText(
          { title: String(r.title), startAt: at, allDay: !r.start_time, location: (r.location as string | null) ?? null },
          offset,
          n,
          locale,
        );
        await db.run(
          `INSERT INTO notifications (id, event_occurrence_id, offset_minutes, scheduled_for, status, title, body, url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [randomUuid(), String(r.id), offset, reminderTime(at, offset).toISOString(), offset === deliver ? 'SENT' : 'CANCELLED', text.title, text.body, `/events/${r.event_id}?occurrence=${r.id}`, stamp],
        );
      }
    }
  }

  async function upcomingReminders(limit: number, days: number): Promise<UpcomingReminder[]> {
    const s = await getSettingsModel();
    const n = now();
    const from = n.toISOString();
    const until = new Date(n.getTime() + days * 86_400_000).toISOString();
    // Occurrences up to MAX_REMINDER_MINUTES past the window can still have a reminder inside it.
    const occUntil = new Date(n.getTime() + days * 86_400_000 + MAX_REMINDER_MINUTES * 60_000).toISOString();
    const locale = { timezone: s.timezone, locale: s.locale, currency: s.currency, timeFormat: s.timeFormat };
    const out: UpcomingReminder[] = [];
    const add = (occurrenceId: string, at: Date, offsets: number[], text: (offset: number, sendAt: Date) => { title: string; body: string }, url: string) => {
      for (const offset of offsets) {
        const sendAt = reminderTime(at, offset);
        const iso = sendAt.toISOString();
        if (iso <= from || iso > until) continue;
        out.push({ key: `${occurrenceId}:${offset}`, at: iso, ...text(offset, sendAt), url });
      }
    };

    const bills = await db.all<SqlRow>(
      `SELECT o.id, o.bill_id, o.due_at, o.due_time, o.amount, b.name, b.payment_method, b.reminder_offsets
       FROM bill_occurrences o JOIN bills b ON b.id = o.bill_id
       WHERE o.status = 'PENDING' AND o.due_at > ? AND o.due_at <= ? AND b.reminder_offsets <> '[]'`,
      [from, occUntil],
    );
    for (const r of bills) {
      const at = new Date(String(r.due_at));
      const bill = { name: String(r.name), amount: String(r.amount), dueAt: at, allDay: !r.due_time, paymentMethod: r.payment_method as BillModel['paymentMethod'] };
      add(String(r.id), at, JSON.parse(String(r.reminder_offsets)) as number[], (offset, sendAt) => billReminderText(bill, offset, sendAt, locale), `/bills/${r.bill_id}?occurrence=${r.id}`);
    }

    const events = await db.all<SqlRow>(
      `SELECT o.id, o.event_id, o.start_at, o.start_time, e.title, e.location, e.reminder_offsets
       FROM event_occurrences o JOIN events e ON e.id = o.event_id
       WHERE o.status = 'UPCOMING' AND o.start_at > ? AND o.start_at <= ? AND e.reminder_offsets <> '[]'`,
      [from, occUntil],
    );
    for (const r of events) {
      const at = new Date(String(r.start_at));
      const event = { title: String(r.title), startAt: at, allDay: !r.start_time, location: (r.location as string | null) ?? null };
      add(String(r.id), at, JSON.parse(String(r.reminder_offsets)) as number[], (offset, sendAt) => eventReminderText(event, offset, sendAt, locale), `/events/${r.event_id}?occurrence=${r.id}`);
    }

    return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1)).slice(0, limit);
  }

  async function createBackup(): Promise<LocalBackup> {
    const tables: Record<string, SqlRow[]> = {};
    for (const t of BACKUP_TABLES) tables[t] = await db.all(`SELECT * FROM ${t}`);
    return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, createdAt: now().toISOString(), tables };
  }

  async function restoreBackup(input: unknown) {
    const b = input as Partial<LocalBackup> | null;
    if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || !b.tables) {
      throw badRequest('This file is not a Bill Calendar backup.');
    }
    if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) {
      throw badRequest('This backup was made by a newer version of the app. Update the app, then restore it.');
    }
    const tables = b.tables as Record<string, unknown>;
    if (!Array.isArray(tables.profile) || tables.profile.length !== 1 || !Array.isArray(tables.settings) || tables.settings.length !== 1) {
      throw badRequest('This backup is incomplete.');
    }
    for (const t of [...BACKUP_TABLES].reverse()) await run(`DELETE FROM ${t}`);
    for (const t of BACKUP_TABLES) {
      const rows = tables[t] ?? [];
      if (!Array.isArray(rows)) throw badRequest(`This backup is damaged (${t}).`);
      // Only columns this version knows; columns added since the backup keep their defaults.
      const known = new Set((await db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${t}')`)).map((c) => c.name));
      for (const row of rows) {
        if (!row || typeof row !== 'object') throw badRequest(`This backup is damaged (${t}).`);
        const entries = Object.entries(row as Record<string, unknown>).filter(([k]) => known.has(k));
        if (entries.some(([, v]) => v !== null && typeof v !== 'string' && typeof v !== 'number')) throw badRequest(`This backup is damaged (${t}).`);
        await run(`INSERT INTO ${t} (${entries.map(([k]) => k).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`, entries.map(([, v]) => v as SqlValue));
      }
    }
    // Backups from before schema 2 have no status_changed_at: derive it like that migration did.
    await run(`UPDATE bill_occurrences SET status_changed_at = COALESCE(completed_at, updated_at) WHERE status <> 'PENDING' AND status_changed_at IS NULL`);
    await run(`UPDATE event_occurrences SET status_changed_at = COALESCE(completed_at, cancelled_at, updated_at) WHERE status <> 'UPCOMING' AND status_changed_at IS NULL`);
    // Pick up anything the backup's age left behind (horizon, auto-pay, due reminders).
    await maintenance();
    // A restored phone is a different data set: it disconnects from any server
    // (reconnecting offers to combine or replace) and nothing is queued for upload.
    for (const t of SYNC_TABLES) await db.run(`DELETE FROM ${t}`);
  }

  async function maintenance() {
    lastMaintenance = now().getTime();
    const s = await getSettingsModel();
    await ensureGenerated();
    await processAutopay(s);
    await planReminders(s);
  }

  // ────────────────────────────────────────────── loaders & views ──

  async function loadBill(id: string) {
    const bill = await one<BillModel>('SELECT * FROM bills WHERE id = ?', [id]);
    if (!bill) throw notFound('Bill');
    return bill;
  }

  async function loadEvent(id: string) {
    const event = await one<EventModel>('SELECT * FROM events WHERE id = ?', [id]);
    if (!event) throw notFound('Event');
    return event;
  }

  /** Occurrence rows → API objects, loading their templates and categories once each. */
  async function billOccurrencesToDto(rows: BillOccurrenceModel[], t: string) {
    const bills = new Map<string, BillModel>();
    const cats = new Map<string, CategoryModel | null>();
    const out = [];
    for (const o of rows) {
      let bill = bills.get(o.billId);
      if (!bill) {
        bill = await loadBill(o.billId);
        bills.set(bill.id, bill);
      }
      const key = bill.categoryId ?? '';
      if (!cats.has(key)) cats.set(key, await categoryById(bill.categoryId));
      out.push(serializeBillOccurrence(o, bill, cats.get(key) ?? null, t));
    }
    return out;
  }

  async function eventOccurrencesToDto(rows: EventOccurrenceModel[]) {
    const events = new Map<string, EventModel>();
    const cats = new Map<string, CategoryModel | null>();
    const out = [];
    for (const o of rows) {
      let event = events.get(o.eventId);
      if (!event) {
        event = await loadEvent(o.eventId);
        events.set(event.id, event);
      }
      const key = event.categoryId ?? '';
      if (!cats.has(key)) cats.set(key, await categoryById(event.categoryId));
      out.push(serializeEventOccurrence(o, event, cats.get(key) ?? null));
    }
    return out;
  }

  async function loadBillOccurrence(id: string) {
    const o = await one<BillOccurrenceModel>('SELECT * FROM bill_occurrences WHERE id = ?', [id]);
    if (!o) throw notFound('Bill occurrence');
    return o;
  }

  async function loadEventOccurrence(id: string) {
    const o = await one<EventOccurrenceModel>('SELECT * FROM event_occurrences WHERE id = ?', [id]);
    if (!o) throw notFound('Event occurrence');
    return o;
  }

  async function billOccurrenceDto(id: string) {
    return (await billOccurrencesToDto([await loadBillOccurrence(id)], await today()))[0]!;
  }

  async function eventOccurrenceDto(id: string) {
    return (await eventOccurrencesToDto([await loadEventOccurrence(id)]))[0]!;
  }

  /** Single-row occurrence change + its own audit entry. */
  async function transitionBill(o: BillOccurrenceModel, patch: Partial<BillOccurrenceModel>, action: string) {
    const changes = diff(o, patch);
    const stamp = now().toISOString();
    await update('bill_occurrences', o.id, { ...patch, ...('status' in patch ? { statusChangedAt: stamp } : {}), updatedAt: stamp });
    await audit('BILL_OCCURRENCE', o.id, action, changes);
  }

  async function transitionEvent(o: EventOccurrenceModel, patch: Partial<EventOccurrenceModel>, action: string) {
    const changes = diff(o, patch);
    const stamp = now().toISOString();
    await update('event_occurrences', o.id, { ...patch, ...('status' in patch ? { statusChangedAt: stamp } : {}), updatedAt: stamp });
    await audit('EVENT_OCCURRENCE', o.id, action, changes);
  }

  /** Extends recurring series on demand when a view asks for dates past the horizon. */
  async function ensureRange(end: string | undefined, t: string) {
    if (!end || end <= t) return;
    const cap = addDays(t, 5 * 366);
    await ensureGenerated(end < cap ? end : cap);
  }

  async function exportAll() {
    const t = await today();
    const settings = await getSettingsModel();
    const cats = await all<CategoryModel>('SELECT * FROM categories ORDER BY type, sort_order');
    const bills = await all<BillModel>('SELECT * FROM bills');
    const events = await all<EventModel>('SELECT * FROM events');
    const catOf = (id: string | null) => cats.find((c) => c.id === id) ?? null;
    return {
      exportedAt: now().toISOString(),
      format: 'skr-bill-calendar-export@1',
      user: await getUser(),
      settings,
      categories: cats,
      bills: bills.map((b) => serializeBill(b, catOf(b.categoryId))),
      billOccurrences: await billOccurrencesToDto(await all<BillOccurrenceModel>('SELECT * FROM bill_occurrences ORDER BY due_date'), t),
      events: events.map((e) => serializeEvent(e, catOf(e.categoryId))),
      eventOccurrences: await eventOccurrencesToDto(await all<EventOccurrenceModel>('SELECT * FROM event_occurrences ORDER BY event_date')),
    };
  }

  // ─────────────────────────────────────────────────── first start ──

  await migrate(db);
  if (!(await db.all('SELECT id FROM profile LIMIT 1')).length) {
    const stamp = now().toISOString();
    const deviceTz = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    await db.exec('BEGIN');
    try {
      await insert('profile', { id: randomUuid(), email: '', displayName: options.displayName ?? 'Me', createdAt: stamp });
      await insert('settings', {
        id: 1,
        timezone: deviceTz && isValidTimezone(deviceTz) ? deviceTz : 'UTC',
        locale: options.locale ?? 'en-US',
        updatedAt: stamp,
      });
      for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
        await insert('categories', { id: randomUuid(), ...c, icon: null, sortOrder: i, createdAt: stamp, updatedAt: stamp });
      }
      await db.exec('COMMIT');
      db.afterWrite?.();
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
  }

  // ──────────────────────────────────────────────── the repository ──

  const repo: LocalRepository = {
    kind: 'local',

    // ── profile & settings ──
    getProfile: () => op(async () => ({ user: await getUser(), settings: await getSettingsModel() })),

    updateProfile: (input) =>
      op(async () => {
        const body = parse(z.object({ displayName: z.string().trim().min(1).max(80) }), input);
        const user = await getUser();
        await run('UPDATE profile SET display_name = ? WHERE id = ?', [body.displayName, user.id]);
        await audit('USER', user.id, 'PROFILE_UPDATED', body);
        return getUser();
      }),

    updateSettings: (patch) =>
      op(async () => {
        const body = parse(settingsInput, patch);
        const before = await getSettingsModel();
        await update('settings', '1', { ...body, updatedAt: now().toISOString() });
        const after = await getSettingsModel();
        await audit('SETTINGS', 'settings', 'SETTINGS_UPDATED', diff(before, body));
        if (before.timezone !== after.timezone || before.allDayReminderTime !== after.allDayReminderTime) await recomputeInstants(after);
        return after;
      }),

    // ── categories ──
    listCategories: (type) =>
      op(async () => {
        const rows = await db.all<SqlRow>(
          `SELECT c.*,
             (SELECT COUNT(*) FROM bills b WHERE b.category_id = c.id) AS bill_count,
             (SELECT COUNT(*) FROM events e WHERE e.category_id = c.id) AS event_count
           FROM categories c ${type ? 'WHERE c.type = ?' : ''}
           ORDER BY c.type, c.sort_order, c.name COLLATE NOCASE`,
          type ? [type] : [],
        );
        return rows.map((r) => {
          const { billCount, eventCount, ...c } = fromRow<CategoryModel & { billCount: number; eventCount: number }>(r);
          return serializeCategory(c, c.type === 'BILL' ? billCount : eventCount);
        });
      }),

    createCategory: (input) =>
      op(async () => {
        const body = parse(categoryCreateInput, input);
        if ((await all('SELECT id FROM categories WHERE type = ? AND name = ?', [body.type, body.name])).length) {
          throw new ApiError(409, 'CONFLICT', 'A record with these values already exists');
        }
        const stamp = now().toISOString();
        const category: CategoryModel = {
          id: randomUuid(),
          name: body.name,
          type: body.type,
          color: body.color,
          icon: body.icon ?? null,
          sortOrder: body.sortOrder ?? 0,
          createdAt: stamp,
          updatedAt: stamp,
        };
        await insert('categories', category);
        await audit('CATEGORY', category.id, 'CREATED', body);
        return serializeCategory(category, 0);
      }),

    updateCategory: (id, input) =>
      op(async () => {
        const body = parse(categoryUpdateInput, input);
        const existing = await categoryById(id);
        if (!existing) throw notFound('Category');
        if (body.name && body.name !== existing.name) {
          const clash = await all('SELECT id FROM categories WHERE type = ? AND name = ? AND id <> ?', [existing.type, body.name, id]);
          if (clash.length) throw new ApiError(409, 'CONFLICT', 'A record with these values already exists');
        }
        await update('categories', id, { ...body, updatedAt: now().toISOString() });
        await audit('CATEGORY', id, 'UPDATED', body);
        const c = (await categoryById(id))!;
        const usage = await db.all<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${c.type === 'BILL' ? 'bills' : 'events'} WHERE category_id = ?`,
          [id],
        );
        return serializeCategory(c, Number(usage[0]?.n ?? 0));
      }),

    deleteCategory: (id) =>
      op(async () => {
        if (!(await categoryById(id))) throw notFound('Category');
        await run('DELETE FROM categories WHERE id = ?', [id]); // bills/events become uncategorised (ON DELETE SET NULL)
        await audit('CATEGORY', id, 'DELETED');
      }),

    // ── bills ──
    listBills: (query = {}) =>
      op(async () => {
        const t = await today();
        const where: string[] = [];
        const params: SqlValue[] = [];
        const archived = query.archived ?? 'false';
        if (archived !== 'all') {
          where.push('is_archived = ?');
          params.push(archived === 'true' ? 1 : 0);
        }
        if (query.categoryId) {
          where.push('category_id = ?');
          params.push(query.categoryId);
        }
        if (query.recurring) where.push(query.recurring === 'true' ? 'recurrence_frequency IS NOT NULL' : 'recurrence_frequency IS NULL');
        if (query.search?.trim()) {
          where.push("LOWER(name) LIKE ? ESCAPE '\\'");
          params.push(`%${likeEscape(query.search.trim().toLowerCase())}%`);
        }
        const bills = await all<BillModel>(
          `SELECT * FROM bills ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name COLLATE NOCASE`,
          params,
        );
        const out = [];
        for (const b of bills) {
          const next = await db.all<{ d: string | null }>(
            "SELECT MIN(due_date) AS d FROM bill_occurrences WHERE bill_id = ? AND status = 'PENDING' AND due_date >= ?",
            [b.id, t],
          );
          const overdue = await db.all<{ n: number }>(
            "SELECT COUNT(*) AS n FROM bill_occurrences WHERE bill_id = ? AND status = 'PENDING' AND due_date < ?",
            [b.id, t],
          );
          out.push({ ...serializeBill(b, await categoryById(b.categoryId)), nextDueDate: next[0]?.d ?? null, overdueCount: Number(overdue[0]?.n ?? 0) });
        }
        return out;
      }),

    getBill: (id) =>
      op(async () => {
        const bill = await loadBill(id);
        const stats = await db.all<SqlRow>(
          'SELECT status, COUNT(*) AS n FROM bill_occurrences WHERE bill_id = ? GROUP BY status',
          [id],
        );
        const result: Record<string, { count: number; amountPaid: string }> = {};
        for (const s of stats) {
          const paid = await db.all<{ amount_paid: string | null }>(
            'SELECT amount_paid FROM bill_occurrences WHERE bill_id = ? AND status = ? AND amount_paid IS NOT NULL',
            [id, String(s.status)],
          );
          result[String(s.status)] = { count: Number(s.n), amountPaid: fromCents(paid.reduce((sum, r) => sum + toCents(r.amount_paid!), 0)) };
        }
        return { ...serializeBill(bill, await categoryById(bill.categoryId)), stats: result };
      }),

    createBill: (input) =>
      op(async () => {
        const body = parse(billInput, input);
        await assertCategory(body.categoryId, 'BILL');
        const s = await getSettingsModel();
        const stamp = now().toISOString();
        const bill: BillModel = { id: randomUuid(), ...billColumns(body, s.defaultBillReminders), generatedUntil: null, isArchived: false, createdAt: stamp, updatedAt: stamp };
        await insert('bills', bill);
        await generateForNewBill(bill, s);
        await audit('BILL', bill.id, 'CREATED', body);
        return serializeBill(await loadBill(bill.id), await categoryById(bill.categoryId));
      }),

    updateBill: (id, input) =>
      op(async () => {
        const body = parse(billInput, input);
        await assertCategory(body.categoryId, 'BILL');
        const existing = await loadBill(id);
        const s = await getSettingsModel();
        const data = billColumns(body, existing.reminderOffsets);
        const changes = diff(existing, data);
        const scheduleChanged = BILL_SCHEDULE_FIELDS.some((f) => f in changes);
        await update('bills', id, { ...data, updatedAt: now().toISOString() });
        const updated = await loadBill(id);
        if (scheduleChanged) {
          await regenerateBill(updated, s);
        } else if ('amount' in changes) {
          await run(
            "UPDATE bill_occurrences SET amount = ?, updated_at = ? WHERE bill_id = ? AND status = 'PENDING' AND is_modified = 0 AND due_date >= ?",
            [updated.amount, now().toISOString(), id, todayInZone(s.timezone, now())],
          );
        }
        await audit('BILL', id, 'UPDATED', changes);
        return serializeBill(updated, await categoryById(updated.categoryId));
      }),

    setBillArchived: (id, archived) =>
      op(async () => {
        await loadBill(id);
        await update('bills', id, { isArchived: archived, updatedAt: now().toISOString() });
        const bill = await loadBill(id);
        if (bill.recurrenceFrequency) await regenerateBill(bill, await getSettingsModel());
        await audit('BILL', id, archived ? 'ARCHIVED' : 'UNARCHIVED');
      }),

    deleteBill: (id) =>
      op(async () => {
        const bill = await loadBill(id);
        const count = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM bill_occurrences WHERE bill_id = ?', [id]);
        await run('DELETE FROM bills WHERE id = ?', [id]);
        await audit('BILL', id, 'DELETED', { name: bill.name, amount: bill.amount, occurrencesDeleted: Number(count[0]?.n ?? 0) });
      }),

    // ── bill occurrences ──
    listBillOccurrences: (query) =>
      op(async () => {
        const t = await today();
        await ensureRange(query.end, t);
        const where: string[] = [];
        const params: SqlValue[] = [];
        if (query.billId) {
          where.push('o.bill_id = ?');
          params.push(query.billId);
        }
        if (query.categoryId) {
          where.push('b.category_id = ?');
          params.push(query.categoryId);
        }
        if (query.start) {
          where.push('o.due_date >= ?');
          params.push(query.start);
        }
        if (query.end) {
          where.push('o.due_date <= ?');
          params.push(query.end);
        }
        if (query.status === 'OVERDUE') {
          where.push("o.status = 'PENDING' AND o.due_date < ?");
          params.push(t);
        } else if (query.status) {
          where.push('o.status = ?');
          params.push(query.status);
        }
        const dir = query.order === 'desc' ? 'DESC' : 'ASC';
        const rows = await all<BillOccurrenceModel>(
          `${BILL_OCC_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.due_date ${dir}, o.due_at ${dir} LIMIT ?`,
          [...params, Math.min(Math.max(query.limit ?? 500, 1), 1000)],
        );
        return billOccurrencesToDto(rows, t);
      }),

    getBillOccurrence: (id) => op(() => billOccurrenceDto(id)),

    completeBillOccurrence: (id, input = {}) =>
      op(async () => {
        const body = parse(
          z.object({
            completedAt: z.string().datetime({ offset: true }).optional(),
            amountPaid: z.union([z.string(), z.number()]).nullish(),
            confirmationNumber: z.string().trim().max(120).nullish(),
            notes: z.string().trim().max(5000).nullish(),
          }),
          input,
        );
        const o = await loadBillOccurrence(id);
        if (o.status === 'COMPLETED') throw badRequest('This occurrence is already completed');
        const completedAt = body.completedAt ? new Date(body.completedAt) : now();
        if (completedAt.getTime() > now().getTime() + 5 * 60_000) throw badRequest('Completion date cannot be in the future');
        await transitionBill(
          o,
          {
            status: 'COMPLETED',
            completedAt: completedAt.toISOString(),
            amountPaid: body.amountPaid != null && String(body.amountPaid).trim() !== '' ? money(body.amountPaid) : o.amount,
            confirmationNumber: body.confirmationNumber || o.confirmationNumber,
            ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
          },
          'COMPLETED',
        );
        return billOccurrenceDto(id);
      }),

    skipBillOccurrence: (id, input = {}) =>
      op(async () => {
        const o = await loadBillOccurrence(id);
        if (o.status === 'SKIPPED') throw badRequest('This occurrence is already skipped');
        await transitionBill(
          o,
          { status: 'SKIPPED', completedAt: null, amountPaid: null, ...(input.notes !== undefined ? { notes: input.notes || null } : {}) },
          'SKIPPED',
        );
        return billOccurrenceDto(id);
      }),

    reopenBillOccurrence: (id) =>
      op(async () => {
        const o = await loadBillOccurrence(id);
        if (o.status === 'PENDING') throw badRequest('This occurrence is already pending');
        // Clearing autopayAt stops auto-pay from immediately re-completing it.
        await transitionBill(o, { status: 'PENDING', completedAt: null, amountPaid: null, autopayAt: null }, 'REOPENED');
        return billOccurrenceDto(id);
      }),

    updateBillOccurrence: (id, input) =>
      op(async () => {
        const body = parse(
          z.object({
            dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
            amount: z.union([z.string(), z.number()]).optional(),
            notes: z.string().trim().max(5000).nullish(),
            confirmationNumber: z.string().trim().max(120).nullish(),
          }),
          input,
        );
        const o = await loadBillOccurrence(id);
        const bill = await loadBill(o.billId);
        const s = await getSettingsModel();
        const dueDate = body.dueDate ?? o.dueDate;
        const dueTime = body.dueTime === undefined ? o.dueTime : body.dueTime;
        const patch: Partial<BillOccurrenceModel> = { dueDate, dueTime, ...billInstantColumns(dueDate, dueTime, bill, s), isModified: true };
        if (body.amount !== undefined) patch.amount = money(body.amount);
        if (body.notes !== undefined) patch.notes = body.notes || null;
        if (body.confirmationNumber !== undefined) patch.confirmationNumber = body.confirmationNumber || null;
        await transitionBill(o, patch, 'UPDATED');
        return billOccurrenceDto(id);
      }),

    // ── events ──
    listEvents: (query = {}) =>
      op(async () => {
        const t = await today();
        const where: string[] = [];
        const params: SqlValue[] = [];
        const archived = query.archived ?? 'false';
        if (archived !== 'all') {
          where.push('is_archived = ?');
          params.push(archived === 'true' ? 1 : 0);
        }
        if (query.categoryId) {
          where.push('category_id = ?');
          params.push(query.categoryId);
        }
        if (query.recurring) where.push(query.recurring === 'true' ? 'recurrence_frequency IS NOT NULL' : 'recurrence_frequency IS NULL');
        if (query.search?.trim()) {
          where.push("LOWER(title) LIKE ? ESCAPE '\\'");
          params.push(`%${likeEscape(query.search.trim().toLowerCase())}%`);
        }
        const events = await all<EventModel>(
          `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY title COLLATE NOCASE`,
          params,
        );
        const out = [];
        for (const e of events) {
          const next = await db.all<{ d: string | null }>(
            "SELECT MIN(event_date) AS d FROM event_occurrences WHERE event_id = ? AND status = 'UPCOMING' AND event_date >= ?",
            [e.id, t],
          );
          out.push({ ...serializeEvent(e, await categoryById(e.categoryId)), nextDate: next[0]?.d ?? null });
        }
        return out;
      }),

    getEvent: (id) =>
      op(async () => {
        const event = await loadEvent(id);
        const stats = await db.all<{ status: string; n: number }>(
          'SELECT status, COUNT(*) AS n FROM event_occurrences WHERE event_id = ? GROUP BY status',
          [id],
        );
        return {
          ...serializeEvent(event, await categoryById(event.categoryId)),
          stats: Object.fromEntries(stats.map((s) => [s.status, { count: Number(s.n) }])),
        };
      }),

    createEvent: (input) =>
      op(async () => {
        const body = parse(eventInput, input);
        await assertCategory(body.categoryId, 'EVENT');
        const s = await getSettingsModel();
        const stamp = now().toISOString();
        const event: EventModel = { id: randomUuid(), ...eventColumns(body, s.defaultEventReminders), generatedUntil: null, isArchived: false, createdAt: stamp, updatedAt: stamp };
        await insert('events', event);
        await generateForNewEvent(event, s);
        await audit('EVENT', event.id, 'CREATED', body);
        return serializeEvent(await loadEvent(event.id), await categoryById(event.categoryId));
      }),

    updateEvent: (id, input) =>
      op(async () => {
        const body = parse(eventInput, input);
        await assertCategory(body.categoryId, 'EVENT');
        const existing = await loadEvent(id);
        const s = await getSettingsModel();
        const data = eventColumns(body, existing.reminderOffsets);
        const changes = diff(existing, data);
        await update('events', id, { ...data, updatedAt: now().toISOString() });
        const updated = await loadEvent(id);
        if (EVENT_SCHEDULE_FIELDS.some((f) => f in changes)) await regenerateEvent(updated, s);
        await audit('EVENT', id, 'UPDATED', changes);
        return serializeEvent(updated, await categoryById(updated.categoryId));
      }),

    setEventArchived: (id, archived) =>
      op(async () => {
        await loadEvent(id);
        await update('events', id, { isArchived: archived, updatedAt: now().toISOString() });
        const event = await loadEvent(id);
        if (event.recurrenceFrequency) await regenerateEvent(event, await getSettingsModel());
        await audit('EVENT', id, archived ? 'ARCHIVED' : 'UNARCHIVED');
      }),

    deleteEvent: (id) =>
      op(async () => {
        const event = await loadEvent(id);
        const count = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM event_occurrences WHERE event_id = ?', [id]);
        await run('DELETE FROM events WHERE id = ?', [id]);
        await audit('EVENT', id, 'DELETED', { title: event.title, occurrencesDeleted: Number(count[0]?.n ?? 0) });
      }),

    // ── event occurrences ──
    listEventOccurrences: (query) =>
      op(async () => {
        const t = await today();
        await ensureRange(query.end, t);
        const where: string[] = [];
        const params: SqlValue[] = [];
        if (query.eventId) {
          where.push('o.event_id = ?');
          params.push(query.eventId);
        }
        if (query.categoryId) {
          where.push('e.category_id = ?');
          params.push(query.categoryId);
        }
        if (query.status) {
          where.push('o.status = ?');
          params.push(query.status);
        }
        if (query.start) {
          where.push('o.event_date >= ?');
          params.push(query.start);
        }
        if (query.end) {
          where.push('o.event_date <= ?');
          params.push(query.end);
        }
        const dir = query.order === 'desc' ? 'DESC' : 'ASC';
        const rows = await all<EventOccurrenceModel>(
          `${EVENT_OCC_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.event_date ${dir}, o.start_at ${dir} LIMIT ?`,
          [...params, Math.min(Math.max(query.limit ?? 500, 1), 1000)],
        );
        return eventOccurrencesToDto(rows);
      }),

    getEventOccurrence: (id) => op(() => eventOccurrenceDto(id)),

    completeEventOccurrence: (id, input = {}) =>
      op(async () => {
        const o = await loadEventOccurrence(id);
        if (o.status === 'COMPLETED') throw badRequest('This occurrence is already completed');
        await transitionEvent(
          o,
          { status: 'COMPLETED', completedAt: now().toISOString(), cancelledAt: null, ...(input.notes !== undefined ? { notes: input.notes || null } : {}) },
          'COMPLETED',
        );
        return eventOccurrenceDto(id);
      }),

    cancelEventOccurrence: (id, input = {}) =>
      op(async () => {
        const o = await loadEventOccurrence(id);
        if (o.status === 'CANCELLED') throw badRequest('This occurrence is already cancelled');
        await transitionEvent(
          o,
          { status: 'CANCELLED', cancelledAt: now().toISOString(), completedAt: null, ...(input.notes !== undefined ? { notes: input.notes || null } : {}) },
          'CANCELLED',
        );
        return eventOccurrenceDto(id);
      }),

    reopenEventOccurrence: (id) =>
      op(async () => {
        const o = await loadEventOccurrence(id);
        if (o.status === 'UPCOMING') throw badRequest('This occurrence is already upcoming');
        await transitionEvent(o, { status: 'UPCOMING', completedAt: null, cancelledAt: null }, 'REOPENED');
        return eventOccurrenceDto(id);
      }),

    updateEventOccurrence: (id, input) =>
      op(async () => {
        const body = parse(
          z.object({
            eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
            endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
            notes: z.string().trim().max(5000).nullish(),
          }),
          input,
        );
        const o = await loadEventOccurrence(id);
        const s = await getSettingsModel();
        const eventDate = body.eventDate ?? o.eventDate;
        const startTime = body.startTime === undefined ? o.startTime : body.startTime;
        const endTime = startTime ? (body.endTime === undefined ? o.endTime : body.endTime) : null;
        const patch: Partial<EventOccurrenceModel> = {
          eventDate,
          startTime,
          endTime,
          ...eventInstantColumns(eventDate, startTime, endTime, s),
          isModified: true,
        };
        if (body.notes !== undefined) patch.notes = body.notes || null;
        await transitionEvent(o, patch, 'UPDATED');
        return eventOccurrenceDto(id);
      }),

    // ── views ──
    getCalendar: (start, end, filter) =>
      op(async () => {
        if (start > end) throw badRequest('start must be before end');
        if (daysBetween(start, end) > MAX_CALENDAR_DAYS) throw badRequest(`Range cannot exceed ${MAX_CALENDAR_DAYS} days`);
        const s = await getSettingsModel();
        const t = todayInZone(s.timezone, now());
        await ensureRange(end, t);
        const items: CalendarItem[] = [];
        if (filter !== 'events') {
          const rows = await all<BillOccurrenceModel>(
            'SELECT * FROM bill_occurrences WHERE due_date >= ? AND due_date <= ? ORDER BY due_date, due_at',
            [start, end],
          );
          for (const o of await billOccurrencesToDto(rows, t)) {
            items.push({
              id: `bill:${o.id}`,
              kind: 'bill',
              occurrenceId: o.id,
              templateId: o.billId,
              title: o.name,
              date: o.dueDate,
              allDay: !o.dueTime,
              start: o.dueTime ? o.dueAt : o.dueDate,
              end: null,
              status: effectiveBillStatus(o.storedStatus, o.dueDate, t),
              amount: o.amount,
              paymentMethod: o.paymentMethod,
              isRecurring: o.isRecurring,
              color: o.category?.color ?? null,
              categoryName: o.category?.name ?? null,
            });
          }
        }
        if (filter !== 'bills') {
          const rows = await all<EventOccurrenceModel>(
            'SELECT * FROM event_occurrences WHERE event_date >= ? AND event_date <= ? ORDER BY event_date, start_at',
            [start, end],
          );
          for (const o of await eventOccurrencesToDto(rows)) {
            items.push({
              id: `event:${o.id}`,
              kind: 'event',
              occurrenceId: o.id,
              templateId: o.eventId,
              title: o.title,
              date: o.eventDate,
              allDay: o.allDay,
              start: o.startTime ? o.startAt : o.eventDate,
              end: o.endAt,
              status: o.status,
              amount: null,
              paymentMethod: null,
              isRecurring: o.isRecurring,
              color: o.category?.color ?? null,
              categoryName: o.category?.name ?? null,
            });
          }
        }
        return { timezone: s.timezone, today: t, items };
      }),

    getDashboard: () =>
      op(async () => {
        const s = await getSettingsModel();
        const t = todayInZone(s.timezone, now());
        const weekStart = startOfWeek(t, s.weekStartsOn);
        const weekEnd = addDays(weekStart, 6);
        const monthStart = startOfMonth(t);
        const monthEnd = endOfMonth(t);
        const billRange = (from: string, to: string) =>
          all<BillOccurrenceModel>('SELECT * FROM bill_occurrences WHERE due_date >= ? AND due_date <= ? ORDER BY due_date, due_at', [from, to]);

        const todayRows = await billRange(t, t);
        const weekRows = await billRange(weekStart, weekEnd);
        const monthRows = await billRange(monthStart, monthEnd);
        const overdueRows = await all<BillOccurrenceModel>(
          "SELECT * FROM bill_occurrences WHERE status = 'PENDING' AND due_date < ? ORDER BY due_date LIMIT 50",
          [t],
        );
        const upcoming = await all<EventOccurrenceModel>(
          "SELECT * FROM event_occurrences WHERE status = 'UPCOMING' AND event_date >= ? AND event_date <= ? ORDER BY event_date, start_at LIMIT 15",
          [t, addDays(t, 30)],
        );
        const recentBills = await all<BillOccurrenceModel>(
          "SELECT * FROM bill_occurrences WHERE status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 8",
        );
        const recentEvents = await all<EventOccurrenceModel>(
          "SELECT * FROM event_occurrences WHERE status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 8",
        );
        const summary = (rows: BillOccurrenceModel[]) => summarizeBills(rows, t);
        return {
          today: t,
          timezone: s.timezone,
          currency: s.currency,
          range: { weekStart, weekEnd, monthStart, monthEnd },
          billsDueToday: await billOccurrencesToDto(todayRows, t),
          billsDueThisWeek: await billOccurrencesToDto(weekRows, t),
          billsDueThisMonth: await billOccurrencesToDto(monthRows, t),
          overdueBills: await billOccurrencesToDto(overdueRows, t),
          upcomingEvents: await eventOccurrencesToDto(upcoming),
          recentlyCompletedBills: await billOccurrencesToDto(recentBills, t),
          recentlyCompletedEvents: await eventOccurrencesToDto(recentEvents),
          summary: { today: summary(todayRows), week: summary(weekRows), month: summary(monthRows), overdue: summary(overdueRows) },
        };
      }),

    getHistory: (kind, id) =>
      op(async () => {
        const rows = await db.all<SqlRow>(
          'SELECT id, action, actor_type, changes, created_at FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200',
          [HISTORY_ENTITY[kind], id],
        );
        return rows.map(
          (r): HistoryEntry => ({
            id: String(r.id),
            action: String(r.action),
            actorType: r.actor_type === 'SYSTEM' ? 'SYSTEM' : 'USER',
            changes: r.changes ? (JSON.parse(String(r.changes)) as HistoryEntry['changes']) : null,
            createdAt: String(r.created_at),
          }),
        );
      }),

    // ── notifications ──
    listNotifications: (query = {}) =>
      op(async () => {
        const rows = await db.all<SqlRow>(
          `SELECT * FROM notifications WHERE status = 'SENT' ${query.unreadOnly ? 'AND read_at IS NULL' : ''}
           ORDER BY scheduled_for DESC LIMIT ?`,
          [Math.min(Math.max(query.limit ?? 50, 1), 200)],
        );
        return rows.map(
          (r): AppNotification => ({
            id: String(r.id),
            title: String(r.title),
            body: String(r.body),
            url: (r.url as string | null) ?? null,
            scheduledFor: String(r.scheduled_for),
            readAt: (r.read_at as string | null) ?? null,
            billOccurrenceId: (r.bill_occurrence_id as string | null) ?? null,
            eventOccurrenceId: (r.event_occurrence_id as string | null) ?? null,
          }),
        );
      }),

    getUnreadNotificationCount: () =>
      op(async () => {
        const r = await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE status = 'SENT' AND read_at IS NULL");
        return Number(r[0]?.n ?? 0);
      }),

    markNotificationRead: (id) =>
      op(async () => {
        if (!(await db.all('SELECT id FROM notifications WHERE id = ?', [id])).length) throw notFound('Notification');
        await run('UPDATE notifications SET read_at = ? WHERE id = ?', [now().toISOString(), id]);
      }),

    markAllNotificationsRead: () =>
      op(async () => {
        await run("UPDATE notifications SET read_at = ? WHERE status = 'SENT' AND read_at IS NULL", [now().toISOString()]);
      }),

    // ── data portability ──
    exportData: () => op(exportAll),

    // ── local-only ──
    runMaintenance: () => op(maintenance, false),
    createBackup: () => op(createBackup, false),
    subscribeChanges: (fn) => {
      changeListeners.add(fn);
      return () => void changeListeners.delete(fn);
    },
    sync: Object.fromEntries(
      Object.entries(createSyncStore(db, run)).map(([name, fn]) => [name, (...args: unknown[]) => op(() => (fn as (...a: unknown[]) => Promise<unknown>)(...args), false)]),
    ) as SyncStore,
    restoreBackup: (backup) => op(() => restoreBackup(backup), false),
    getUpcomingReminders: ({ limit = 100, days = 60 } = {}) => op(() => upcomingReminders(Math.max(1, Math.min(limit, 500)), days)),
    close: async () => {
      await queue;
      await db.close();
    },
  };
  return repo;
}
