import type { AuditLog, Bill, BillOccurrence, Category, Event, EventOccurrence, Prisma, UserSettings } from '@prisma/client';
import {
  fromIsoDate,
  toIsoDate,
  type SyncAuditLog,
  type SyncBill,
  type SyncBillOccurrence,
  type SyncCategory,
  type SyncEvent,
  type SyncEventOccurrence,
  type SyncSettings,
} from '@skr/core';

/**
 * Database rows ⇄ sync records (@skr/core sync.ts). Sync records are whole
 * rows with portable values: dates YYYY-MM-DD, instants ISO UTC, money "0.00".
 */

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const date = (d: Date | null) => (d ? toIsoDate(d) : null);
const money = (v: { toFixed(n: number): string } | null) => (v == null ? null : v.toFixed(2));
const toDate = (s: string | null) => (s ? fromIsoDate(s) : null);
const toInstant = (s: string | null) => (s ? new Date(s) : null);

export const settingsToSync = (s: UserSettings): SyncSettings => ({
  timezone: s.timezone,
  theme: s.theme,
  weekStartsOn: s.weekStartsOn,
  currency: s.currency,
  locale: s.locale,
  timeFormat: s.timeFormat as SyncSettings['timeFormat'],
  defaultCalendarView: s.defaultCalendarView as SyncSettings['defaultCalendarView'],
  defaultBillReminders: s.defaultBillReminders,
  defaultEventReminders: s.defaultEventReminders,
  allDayReminderTime: s.allDayReminderTime,
  autoCompleteAutopay: s.autoCompleteAutopay,
  updatedAt: s.updatedAt.toISOString(),
});

export const settingsFromSync = (r: SyncSettings) => ({
  timezone: r.timezone,
  theme: r.theme,
  weekStartsOn: r.weekStartsOn,
  currency: r.currency,
  locale: r.locale,
  timeFormat: r.timeFormat,
  defaultCalendarView: r.defaultCalendarView,
  defaultBillReminders: r.defaultBillReminders,
  defaultEventReminders: r.defaultEventReminders,
  allDayReminderTime: r.allDayReminderTime,
  autoCompleteAutopay: r.autoCompleteAutopay,
  updatedAt: new Date(r.updatedAt),
});

export const categoryToSync = (c: Category): SyncCategory => ({
  id: c.id,
  type: c.type,
  name: c.name,
  color: c.color,
  icon: c.icon,
  sortOrder: c.sortOrder,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export const categoryFromSync = (r: SyncCategory, userId: string): Prisma.CategoryUncheckedCreateInput => ({
  id: r.id,
  userId,
  type: r.type,
  name: r.name,
  color: r.color,
  icon: r.icon,
  sortOrder: r.sortOrder,
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
});

type TemplateRow = Pick<
  Bill,
  | 'id'
  | 'categoryId'
  | 'description'
  | 'notes'
  | 'startDate'
  | 'recurrenceFrequency'
  | 'recurrenceInterval'
  | 'recurrenceByWeekday'
  | 'recurrenceEndDate'
  | 'recurrenceCount'
  | 'reminderOffsets'
  | 'generatedUntil'
  | 'isArchived'
  | 'createdAt'
  | 'updatedAt'
>;

const templateToSync = (t: TemplateRow) => ({
  id: t.id,
  categoryId: t.categoryId,
  description: t.description,
  notes: t.notes,
  startDate: toIsoDate(t.startDate),
  recurrenceFrequency: t.recurrenceFrequency,
  recurrenceInterval: t.recurrenceInterval,
  recurrenceByWeekday: t.recurrenceByWeekday,
  recurrenceEndDate: date(t.recurrenceEndDate),
  recurrenceCount: t.recurrenceCount,
  reminderOffsets: t.reminderOffsets,
  generatedUntil: date(t.generatedUntil),
  isArchived: t.isArchived,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

type TemplateRecord = Omit<SyncBill, 'name' | 'amount' | 'paymentMethod' | 'scheduledPayDaysBefore' | 'dueTime'>;

const templateFromSync = (r: TemplateRecord, userId: string) => ({
  id: r.id,
  userId,
  categoryId: r.categoryId,
  description: r.description,
  notes: r.notes,
  startDate: fromIsoDate(r.startDate),
  recurrenceFrequency: r.recurrenceFrequency,
  recurrenceInterval: r.recurrenceInterval,
  recurrenceByWeekday: r.recurrenceByWeekday,
  recurrenceEndDate: toDate(r.recurrenceEndDate),
  recurrenceCount: r.recurrenceCount,
  reminderOffsets: r.reminderOffsets,
  generatedUntil: toDate(r.generatedUntil),
  isArchived: r.isArchived,
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
});

export const billToSync = (b: Bill): SyncBill => ({
  ...templateToSync(b),
  name: b.name,
  amount: b.amount.toFixed(2),
  paymentMethod: b.paymentMethod,
  scheduledPayDaysBefore: b.scheduledPayDaysBefore,
  dueTime: b.dueTime,
});

export const billFromSync = (r: SyncBill, userId: string): Prisma.BillUncheckedCreateInput => ({
  ...templateFromSync(r, userId),
  name: r.name,
  amount: r.amount,
  paymentMethod: r.paymentMethod,
  scheduledPayDaysBefore: r.scheduledPayDaysBefore,
  dueTime: r.dueTime,
});

export const eventToSync = (e: Event): SyncEvent => ({
  ...templateToSync(e),
  title: e.title,
  location: e.location,
  startTime: e.startTime,
  endTime: e.endTime,
});

export const eventFromSync = (r: SyncEvent, userId: string): Prisma.EventUncheckedCreateInput => ({
  ...templateFromSync(r, userId),
  title: r.title,
  location: r.location,
  startTime: r.startTime,
  endTime: r.endTime,
});

export const billOccurrenceToSync = (o: BillOccurrence): SyncBillOccurrence => ({
  id: o.id,
  billId: o.billId,
  originalDueDate: toIsoDate(o.originalDueDate),
  dueDate: toIsoDate(o.dueDate),
  dueTime: o.dueTime,
  dueAt: o.dueAt.toISOString(),
  amount: o.amount.toFixed(2),
  status: o.status,
  completedAt: iso(o.completedAt),
  amountPaid: money(o.amountPaid),
  confirmationNumber: o.confirmationNumber,
  notes: o.notes,
  scheduledPayDate: date(o.scheduledPayDate),
  autopayAt: iso(o.autopayAt),
  isModified: o.isModified,
  statusChangedAt: iso(o.statusChangedAt),
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
});

export const billOccurrenceFromSync = (r: SyncBillOccurrence, userId: string): Prisma.BillOccurrenceUncheckedCreateInput => ({
  id: r.id,
  billId: r.billId,
  userId,
  originalDueDate: fromIsoDate(r.originalDueDate),
  dueDate: fromIsoDate(r.dueDate),
  dueTime: r.dueTime,
  dueAt: new Date(r.dueAt),
  amount: r.amount,
  status: r.status,
  completedAt: toInstant(r.completedAt),
  amountPaid: r.amountPaid,
  confirmationNumber: r.confirmationNumber,
  notes: r.notes,
  scheduledPayDate: toDate(r.scheduledPayDate),
  autopayAt: toInstant(r.autopayAt),
  isModified: r.isModified,
  statusChangedAt: toInstant(r.statusChangedAt),
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
});

export const eventOccurrenceToSync = (o: EventOccurrence): SyncEventOccurrence => ({
  id: o.id,
  eventId: o.eventId,
  originalDate: toIsoDate(o.originalDate),
  eventDate: toIsoDate(o.eventDate),
  startTime: o.startTime,
  endTime: o.endTime,
  startAt: o.startAt.toISOString(),
  endAt: iso(o.endAt),
  status: o.status,
  completedAt: iso(o.completedAt),
  cancelledAt: iso(o.cancelledAt),
  notes: o.notes,
  isModified: o.isModified,
  statusChangedAt: iso(o.statusChangedAt),
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
});

export const eventOccurrenceFromSync = (r: SyncEventOccurrence, userId: string): Prisma.EventOccurrenceUncheckedCreateInput => ({
  id: r.id,
  eventId: r.eventId,
  userId,
  originalDate: fromIsoDate(r.originalDate),
  eventDate: fromIsoDate(r.eventDate),
  startTime: r.startTime,
  endTime: r.endTime,
  startAt: new Date(r.startAt),
  endAt: toInstant(r.endAt),
  status: r.status,
  completedAt: toInstant(r.completedAt),
  cancelledAt: toInstant(r.cancelledAt),
  notes: r.notes,
  isModified: r.isModified,
  statusChangedAt: toInstant(r.statusChangedAt),
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
});

export const auditToSync = (a: AuditLog): SyncAuditLog => ({
  id: a.id,
  actorType: a.actorType as SyncAuditLog['actorType'],
  entityType: a.entityType as SyncAuditLog['entityType'],
  entityId: a.entityId,
  action: a.action,
  changes: a.changes ?? null,
  createdAt: a.createdAt.toISOString(),
});
