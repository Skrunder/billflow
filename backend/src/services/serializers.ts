import type { Bill, BillOccurrence, Category, Event, EventOccurrence } from '@prisma/client';
import {
  effectiveBillStatus as coreEffectiveBillStatus,
  toIsoDate,
  toRRule,
  type Bill as BillDTO,
  type BillOccurrence as BillOccurrenceDTO,
  type BillStatus,
  type CalendarEvent as EventDTO,
  type EventOccurrence as EventOccurrenceDTO,
} from '@skr/core';
import { billSpec, eventSpec } from './occurrence.service';

/**
 * API representations. Money is returned as a decimal string ("123.45") to
 * avoid floating-point drift; calendar dates as "YYYY-MM-DD"; instants as
 * ISO-8601 UTC strings.
 */

type CategoryLite = Pick<Category, 'id' | 'name' | 'color' | 'icon'> | null;

type Decimalish = { toFixed(n: number): string };

function money(v: Decimalish): string;
function money(v: Decimalish | null | undefined): string | null;
function money(v: Decimalish | null | undefined) {
  return v == null ? null : v.toFixed(2);
}
function iso(d: Date): string;
function iso(d: Date | null | undefined): string | null;
function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}
function date(d: Date): string;
function date(d: Date | null | undefined): string | null;
function date(d: Date | null | undefined) {
  return d ? toIsoDate(d) : null;
}

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

/** OVERDUE is derived (see @skr/core status rules). */
export function effectiveBillStatus(o: Pick<BillOccurrence, 'status' | 'dueDate'>, today: string): BillStatus {
  return coreEffectiveBillStatus(o.status, toIsoDate(o.dueDate), today);
}

export function serializeBill(b: Bill & { category?: CategoryLite }): BillDTO {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    notes: b.notes,
    amount: money(b.amount),
    amountIsEstimate: b.amountIsEstimate,
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
): BillOccurrenceDTO {
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
    amountIsEstimate: o.amountIsEstimate,
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

export function serializeEvent(e: Event & { category?: CategoryLite }): EventDTO {
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

export function serializeEventOccurrence(o: EventOccurrence & { event: Event & { category?: CategoryLite } }): EventOccurrenceDTO {
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
