import {
  effectiveBillStatus,
  toRRule,
  type Bill,
  type BillOccurrence,
  type CalendarEvent,
  type Category,
  type CategoryLite,
  type CategoryType,
  type EventOccurrence,
  type EventStatus,
  type Frequency,
  type PaymentMethod,
  type RecurrenceSpec,
  type Settings,
  type StoredBillStatus,
} from '@skr/core';
import type { SqlRow, SqlValue } from './driver';

/**
 * Row ⇄ model mapping. SQL rows use snake_case columns; models use the same
 * camelCase field names as the server's Prisma models, so audit-log diffs
 * look identical on both sides.
 */

const JSON_FIELDS = new Set(['recurrenceByWeekday', 'reminderOffsets', 'defaultBillReminders', 'defaultEventReminders']);
const BOOL_FIELDS = new Set([
  'amountIsEstimate',
  'isArchived',
  'isModified',
  'autoCompleteAutopay',
  'inAppNotifications',
  'emailNotifications',
  'pushNotifications',
]);

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
export const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function fromRow<T>(row: SqlRow): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = toCamel(k);
    if (JSON_FIELDS.has(key)) out[key] = v == null ? [] : JSON.parse(String(v));
    else if (BOOL_FIELDS.has(key)) out[key] = v === 1;
    else out[key] = v;
  }
  return out as T;
}

export function toSqlValue(key: string, v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (JSON_FIELDS.has(key)) return JSON.stringify(v);
  if (BOOL_FIELDS.has(key) || typeof v === 'boolean') return v ? 1 : 0;
  return v as SqlValue;
}

// ───────────────────────────────────────────────────── models ──

export interface SettingsModel extends Omit<Settings, 'updatedAt'> {
  updatedAt: string;
}

export interface CategoryModel {
  id: string;
  name: string;
  type: CategoryType;
  color: string;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface RecurrenceColumns {
  recurrenceFrequency: Frequency | null;
  recurrenceInterval: number;
  recurrenceByWeekday: number[];
  recurrenceEndDate: string | null;
  recurrenceCount: number | null;
}

export interface BillModel extends RecurrenceColumns {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  notes: string | null;
  amount: string;
  amountIsEstimate: boolean;
  paymentMethod: PaymentMethod;
  scheduledPayDaysBefore: number | null;
  startDate: string;
  dueTime: string | null;
  reminderOffsets: number[];
  generatedUntil: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillOccurrenceModel {
  id: string;
  billId: string;
  originalDueDate: string;
  dueDate: string;
  dueTime: string | null;
  dueAt: string;
  amount: string;
  amountIsEstimate: boolean;
  status: StoredBillStatus;
  completedAt: string | null;
  amountPaid: string | null;
  confirmationNumber: string | null;
  notes: string | null;
  scheduledPayDate: string | null;
  autopayAt: string | null;
  isModified: boolean;
  /** When the status last changed; sync decides status conflicts by it. */
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventModel extends RecurrenceColumns {
  id: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  notes: string | null;
  location: string | null;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  reminderOffsets: number[];
  generatedUntil: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventOccurrenceModel {
  id: string;
  eventId: string;
  originalDate: string;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  startAt: string;
  endAt: string | null;
  status: EventStatus;
  completedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  isModified: boolean;
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function specOf(t: RecurrenceColumns): RecurrenceSpec | null {
  if (!t.recurrenceFrequency) return null;
  return {
    frequency: t.recurrenceFrequency,
    interval: t.recurrenceInterval,
    byWeekday: t.recurrenceByWeekday,
    endDate: t.recurrenceEndDate,
    count: t.recurrenceCount,
  };
}

// ─────────────────────────── serializers (same shapes as the server API) ──

function recurrenceDto(t: RecurrenceColumns) {
  const spec = specOf(t);
  if (!spec) return null;
  return {
    frequency: spec.frequency,
    interval: spec.interval,
    byWeekday: spec.byWeekday ?? [],
    endDate: spec.endDate ?? null,
    count: spec.count ?? null,
    rrule: toRRule(spec),
  };
}

export function categoryLite(c: CategoryModel | null | undefined): CategoryLite | null {
  return c ? { id: c.id, name: c.name, color: c.color, icon: c.icon } : null;
}

export function serializeCategory(c: CategoryModel, usageCount: number): Category {
  return { ...c, usageCount };
}

export function serializeBill(b: BillModel, category: CategoryModel | null): Bill {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    notes: b.notes,
    amount: b.amount,
    amountIsEstimate: b.amountIsEstimate,
    category: categoryLite(category),
    categoryId: b.categoryId,
    paymentMethod: b.paymentMethod,
    scheduledPayDaysBefore: b.scheduledPayDaysBefore,
    startDate: b.startDate,
    dueTime: b.dueTime,
    isRecurring: Boolean(b.recurrenceFrequency),
    recurrence: recurrenceDto(b),
    reminderOffsets: b.reminderOffsets,
    isArchived: b.isArchived,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export function serializeBillOccurrence(o: BillOccurrenceModel, bill: BillModel, category: CategoryModel | null, today: string): BillOccurrence {
  return {
    id: o.id,
    billId: o.billId,
    name: bill.name,
    description: bill.description,
    category: categoryLite(category),
    paymentMethod: bill.paymentMethod,
    isRecurring: Boolean(bill.recurrenceFrequency),
    originalDueDate: o.originalDueDate,
    dueDate: o.dueDate,
    dueTime: o.dueTime,
    dueAt: o.dueAt,
    amount: o.amount,
    amountIsEstimate: o.amountIsEstimate,
    status: effectiveBillStatus(o.status, o.dueDate, today),
    storedStatus: o.status,
    completedAt: o.completedAt,
    amountPaid: o.amountPaid,
    confirmationNumber: o.confirmationNumber,
    notes: o.notes,
    scheduledPayDate: o.scheduledPayDate,
    isModified: o.isModified,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export function serializeEvent(e: EventModel, category: CategoryModel | null): CalendarEvent {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    notes: e.notes,
    location: e.location,
    category: categoryLite(category),
    categoryId: e.categoryId,
    startDate: e.startDate,
    startTime: e.startTime,
    endTime: e.endTime,
    allDay: !e.startTime,
    isRecurring: Boolean(e.recurrenceFrequency),
    recurrence: recurrenceDto(e),
    reminderOffsets: e.reminderOffsets,
    isArchived: e.isArchived,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function serializeEventOccurrence(o: EventOccurrenceModel, event: EventModel, category: CategoryModel | null): EventOccurrence {
  return {
    id: o.id,
    eventId: o.eventId,
    title: event.title,
    description: event.description,
    location: event.location,
    category: categoryLite(category),
    isRecurring: Boolean(event.recurrenceFrequency),
    originalDate: o.originalDate,
    eventDate: o.eventDate,
    startTime: o.startTime,
    endTime: o.endTime,
    allDay: !o.startTime,
    startAt: o.startAt,
    endAt: o.endAt,
    status: o.status,
    completedAt: o.completedAt,
    cancelledAt: o.cancelledAt,
    notes: o.notes,
    isModified: o.isModified,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** Shallow field diff for audit entries (same format as the server). */
export function diff(before: object, after: object): Record<string, { from: unknown; to: unknown }> {
  const b = before as Record<string, unknown>;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    const from = b[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to ?? null)) out[key] = { from, to: to ?? null };
  }
  return out;
}
