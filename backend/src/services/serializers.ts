import type { Bill, BillOccurrence, Category, Event, EventOccurrence } from '@prisma/client';
import { toRRule } from '../lib/recurrence';
import { toIsoDate } from '../lib/time';
import { billSpec, eventSpec } from './occurrence.service';

/**
 * API representations. Money is returned as a decimal string ("123.45") to
 * avoid floating-point drift; calendar dates as "YYYY-MM-DD"; instants as
 * ISO-8601 UTC strings.
 */

type CategoryLite = Pick<Category, 'id' | 'name' | 'color' | 'icon'> | null;

const money = (v: { toFixed(n: number): string } | null | undefined) => (v == null ? null : v.toFixed(2));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const date = (d: Date | null | undefined) => (d ? toIsoDate(d) : null);

export function serializeCategory(c: CategoryLite) {
  return c ? { id: c.id, name: c.name, color: c.color, icon: c.icon } : null;
}

function recurrence(spec: ReturnType<typeof billSpec>) {
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

export type BillOccurrenceStatusOut = 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'OVERDUE';

/** OVERDUE is derived: still pending and the local due date has passed. */
export function effectiveBillStatus(o: Pick<BillOccurrence, 'status' | 'dueDate'>, today: string): BillOccurrenceStatusOut {
  return o.status === 'PENDING' && toIsoDate(o.dueDate) < today ? 'OVERDUE' : o.status;
}

export function serializeBill(b: Bill & { category?: CategoryLite }) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    notes: b.notes,
    amount: money(b.amount),
    category: serializeCategory(b.category ?? null),
    categoryId: b.categoryId,
    paymentMethod: b.paymentMethod,
    scheduledPayDaysBefore: b.scheduledPayDaysBefore,
    startDate: date(b.startDate),
    dueTime: b.dueTime,
    isRecurring: Boolean(b.recurrenceFrequency),
    recurrence: recurrence(billSpec(b)),
    reminderOffsets: b.reminderOffsets,
    isArchived: b.isArchived,
    createdAt: iso(b.createdAt),
    updatedAt: iso(b.updatedAt),
  };
}

export function serializeBillOccurrence(
  o: BillOccurrence & { bill: Bill & { category?: CategoryLite } },
  today: string,
) {
  return {
    id: o.id,
    billId: o.billId,
    name: o.bill.name,
    description: o.bill.description,
    category: serializeCategory(o.bill.category ?? null),
    paymentMethod: o.bill.paymentMethod,
    isRecurring: Boolean(o.bill.recurrenceFrequency),
    originalDueDate: date(o.originalDueDate),
    dueDate: date(o.dueDate),
    dueTime: o.dueTime,
    dueAt: iso(o.dueAt),
    amount: money(o.amount),
    status: effectiveBillStatus(o, today),
    storedStatus: o.status,
    completedAt: iso(o.completedAt),
    amountPaid: money(o.amountPaid),
    confirmationNumber: o.confirmationNumber,
    notes: o.notes,
    scheduledPayDate: date(o.scheduledPayDate),
    isModified: o.isModified,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  };
}

export function serializeEvent(e: Event & { category?: CategoryLite }) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    notes: e.notes,
    location: e.location,
    category: serializeCategory(e.category ?? null),
    categoryId: e.categoryId,
    startDate: date(e.startDate),
    startTime: e.startTime,
    endTime: e.endTime,
    allDay: !e.startTime,
    isRecurring: Boolean(e.recurrenceFrequency),
    recurrence: recurrence(eventSpec(e)),
    reminderOffsets: e.reminderOffsets,
    isArchived: e.isArchived,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  };
}

export function serializeEventOccurrence(o: EventOccurrence & { event: Event & { category?: CategoryLite } }) {
  return {
    id: o.id,
    eventId: o.eventId,
    title: o.event.title,
    description: o.event.description,
    location: o.event.location,
    category: serializeCategory(o.event.category ?? null),
    isRecurring: Boolean(o.event.recurrenceFrequency),
    originalDate: date(o.originalDate),
    eventDate: date(o.eventDate),
    startTime: o.startTime,
    endTime: o.endTime,
    allDay: !o.startTime,
    startAt: iso(o.startAt),
    endAt: iso(o.endAt),
    status: o.status,
    completedAt: iso(o.completedAt),
    cancelledAt: iso(o.cancelledAt),
    notes: o.notes,
    isModified: o.isModified,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  };
}

export const categorySelect = { select: { id: true, name: true, color: true, icon: true } } as const;
