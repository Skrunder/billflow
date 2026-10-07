import type { Bill, Event, Prisma, UserSettings } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { expandDates, type RecurrenceSpec } from '../lib/recurrence';
import { addDays, fromIsoDate, localToUtc, toIsoDate, todayInZone } from '../lib/time';
import type { Db } from './audit.service';
import { getSettings } from './settings.service';

/**
 * Occurrence materialisation.
 *
 * Templates (Bill / Event) describe a schedule; occurrences are concrete rows
 * generated from it. Rules that protect data integrity:
 *   1. Each slot is generated at most once (unique [templateId, originalDate]).
 *   2. Regeneration after a template edit only ever removes occurrences that
 *      are still untouched (PENDING/UPCOMING, not individually modified) and
 *      not in the past. Completed / skipped / cancelled / edited occurrences
 *      are never deleted or rewritten by the system.
 *   3. Status changes are always single-row updates by primary key.
 */

/** How far back a brand-new recurring template is back-filled. */
const BACKFILL_DAYS = 31;

export function billSpec(b: Bill): RecurrenceSpec | null {
  if (!b.recurrenceFrequency) return null;
  return {
    frequency: b.recurrenceFrequency,
    interval: b.recurrenceInterval,
    byWeekday: b.recurrenceByWeekday,
    endDate: b.recurrenceEndDate ? toIsoDate(b.recurrenceEndDate) : null,
    count: b.recurrenceCount,
  };
}

export function eventSpec(e: Event): RecurrenceSpec | null {
  if (!e.recurrenceFrequency) return null;
  return {
    frequency: e.recurrenceFrequency,
    interval: e.recurrenceInterval,
    byWeekday: e.recurrenceByWeekday,
    endDate: e.recurrenceEndDate ? toIsoDate(e.recurrenceEndDate) : null,
    count: e.recurrenceCount,
  };
}

// ───────────────────────────────────────────── derived instants ──

export function billInstants(
  dueDate: string,
  dueTime: string | null,
  bill: Pick<Bill, 'paymentMethod' | 'scheduledPayDaysBefore'>,
  settings: Pick<UserSettings, 'timezone' | 'allDayReminderTime'>,
) {
  const time = dueTime ?? settings.allDayReminderTime;
  const dueAt = localToUtc(dueDate, time, settings.timezone);
  if (bill.paymentMethod === 'MANUAL') return { dueAt, scheduledPayDate: null, autopayAt: null };
  const payDate =
    bill.paymentMethod === 'SCHEDULED_AUTOPAY' ? addDays(dueDate, -(bill.scheduledPayDaysBefore ?? 0)) : dueDate;
  return {
    dueAt,
    scheduledPayDate: fromIsoDate(payDate),
    autopayAt: localToUtc(payDate, time, settings.timezone),
  };
}

export function eventInstants(
  date: string,
  startTime: string | null,
  endTime: string | null,
  settings: Pick<UserSettings, 'timezone' | 'allDayReminderTime'>,
) {
  const startAt = localToUtc(date, startTime ?? settings.allDayReminderTime, settings.timezone);
  let endAt: Date | null = null;
  if (startTime && endTime) {
    // An end time earlier than the start time means the event ends the next day.
    const endDate = endTime <= startTime ? addDays(date, 1) : date;
    endAt = localToUtc(endDate, endTime, settings.timezone);
  }
  return { startAt, endAt };
}

// ───────────────────────────────────────────────── generation ──

export function horizonDate(settings: Pick<UserSettings, 'timezone'>): string {
  return addDays(todayInZone(settings.timezone), env.OCCURRENCE_HORIZON_DAYS);
}

function maxIso(a: string, b: string) {
  return a > b ? a : b;
}

async function insertBillOccurrences(db: Db, bill: Bill, settings: UserSettings, from: string, to: string) {
  const dates = expandDates(toIsoDate(bill.startDate), billSpec(bill), from, to);
  if (dates.length) {
    await db.billOccurrence.createMany({
      data: dates.map((d) => ({
        billId: bill.id,
        userId: bill.userId,
        originalDueDate: fromIsoDate(d),
        dueDate: fromIsoDate(d),
        dueTime: bill.dueTime,
        amount: bill.amount,
        ...billInstants(d, bill.dueTime, bill, settings),
      })),
      skipDuplicates: true,
    });
  }
}

async function insertEventOccurrences(db: Db, event: Event, settings: UserSettings, from: string, to: string) {
  const dates = expandDates(toIsoDate(event.startDate), eventSpec(event), from, to);
  if (dates.length) {
    await db.eventOccurrence.createMany({
      data: dates.map((d) => ({
        eventId: event.id,
        userId: event.userId,
        originalDate: fromIsoDate(d),
        eventDate: fromIsoDate(d),
        startTime: event.startTime,
        endTime: event.endTime,
        ...eventInstants(d, event.startTime, event.endTime, settings),
      })),
      skipDuplicates: true,
    });
  }
}

/** Initial materialisation for a newly created bill. */
export async function generateForNewBill(db: Db, bill: Bill, settings: UserSettings) {
  const start = toIsoDate(bill.startDate);
  if (!bill.recurrenceFrequency) {
    await insertBillOccurrences(db, bill, settings, start, start);
    await db.bill.update({ where: { id: bill.id }, data: { generatedUntil: bill.startDate } });
    return;
  }
  const until = horizonDate(settings);
  const from = maxIso(start, addDays(todayInZone(settings.timezone), -BACKFILL_DAYS));
  await insertBillOccurrences(db, bill, settings, from, until);
  await db.bill.update({ where: { id: bill.id }, data: { generatedUntil: fromIsoDate(until) } });
}

export async function generateForNewEvent(db: Db, event: Event, settings: UserSettings) {
  const start = toIsoDate(event.startDate);
  if (!event.recurrenceFrequency) {
    await insertEventOccurrences(db, event, settings, start, start);
    await db.event.update({ where: { id: event.id }, data: { generatedUntil: event.startDate } });
    return;
  }
  const until = horizonDate(settings);
  const from = maxIso(start, addDays(todayInZone(settings.timezone), -BACKFILL_DAYS));
  await insertEventOccurrences(db, event, settings, from, until);
  await db.event.update({ where: { id: event.id }, data: { generatedUntil: fromIsoDate(until) } });
}

/**
 * Re-applies a changed schedule by reconciling the untouched occurrences
 * (PENDING/UPCOMING, never individually edited, not in the past):
 *   - slots still in the schedule are updated in place (ids, reminders kept)
 *   - slots no longer in the schedule are removed
 *   - new slots are inserted
 * Occurrences with any history (completed, skipped, cancelled, edited, past)
 * are never touched.
 */
export async function regenerateBill(db: Db, bill: Bill, settings: UserSettings) {
  const today = todayInZone(settings.timezone);
  const start = toIsoDate(bill.startDate);
  const recurring = Boolean(bill.recurrenceFrequency);
  const replaceable = await db.billOccurrence.findMany({
    where: {
      billId: bill.id,
      status: 'PENDING',
      isModified: false,
      ...(recurring ? { dueDate: { gte: fromIsoDate(today) } } : {}),
    },
    select: { id: true, originalDueDate: true },
  });

  if (!recurring) {
    const [current, ...extra] = replaceable;
    if (extra.length) await db.billOccurrence.deleteMany({ where: { id: { in: extra.map((o) => o.id) } } });
    if (bill.isArchived) {
      if (current) await db.billOccurrence.delete({ where: { id: current.id } });
    } else if (current) {
      await db.billOccurrence.update({
        where: { id: current.id },
        data: {
          originalDueDate: bill.startDate,
          dueDate: bill.startDate,
          dueTime: bill.dueTime,
          amount: bill.amount,
          ...billInstants(start, bill.dueTime, bill, settings),
        },
      });
    } else if (!(await db.billOccurrence.count({ where: { billId: bill.id } }))) {
      await insertBillOccurrences(db, bill, settings, start, start);
    }
    await db.bill.update({ where: { id: bill.id }, data: { generatedUntil: bill.startDate } });
    return;
  }

  const until = horizonDate(settings);
  const wanted = bill.isArchived ? [] : expandDates(start, billSpec(bill), maxIso(start, today), until);
  const wantedSet = new Set(wanted);
  const stale = replaceable.filter((o) => !wantedSet.has(toIsoDate(o.originalDueDate)));
  const keep = replaceable.filter((o) => wantedSet.has(toIsoDate(o.originalDueDate)));

  if (stale.length) await db.billOccurrence.deleteMany({ where: { id: { in: stale.map((o) => o.id) } } });
  for (const o of keep) {
    const d = toIsoDate(o.originalDueDate);
    await db.billOccurrence.update({
      where: { id: o.id },
      data: { dueDate: o.originalDueDate, dueTime: bill.dueTime, amount: bill.amount, ...billInstants(d, bill.dueTime, bill, settings) },
    });
  }
  if (!bill.isArchived) {
    await insertBillOccurrences(db, bill, settings, maxIso(start, today), until);
    await db.bill.update({ where: { id: bill.id }, data: { generatedUntil: fromIsoDate(until) } });
  }
}

export async function regenerateEvent(db: Db, event: Event, settings: UserSettings) {
  const today = todayInZone(settings.timezone);
  const start = toIsoDate(event.startDate);
  const recurring = Boolean(event.recurrenceFrequency);
  const replaceable = await db.eventOccurrence.findMany({
    where: {
      eventId: event.id,
      status: 'UPCOMING',
      isModified: false,
      ...(recurring ? { eventDate: { gte: fromIsoDate(today) } } : {}),
    },
    select: { id: true, originalDate: true },
  });

  if (!recurring) {
    const [current, ...extra] = replaceable;
    if (extra.length) await db.eventOccurrence.deleteMany({ where: { id: { in: extra.map((o) => o.id) } } });
    if (event.isArchived) {
      if (current) await db.eventOccurrence.delete({ where: { id: current.id } });
    } else if (current) {
      await db.eventOccurrence.update({
        where: { id: current.id },
        data: {
          originalDate: event.startDate,
          eventDate: event.startDate,
          startTime: event.startTime,
          endTime: event.endTime,
          ...eventInstants(start, event.startTime, event.endTime, settings),
        },
      });
    } else if (!(await db.eventOccurrence.count({ where: { eventId: event.id } }))) {
      await insertEventOccurrences(db, event, settings, start, start);
    }
    await db.event.update({ where: { id: event.id }, data: { generatedUntil: event.startDate } });
    return;
  }

  const until = horizonDate(settings);
  const wanted = event.isArchived ? [] : expandDates(start, eventSpec(event), maxIso(start, today), until);
  const wantedSet = new Set(wanted);
  const stale = replaceable.filter((o) => !wantedSet.has(toIsoDate(o.originalDate)));
  const keep = replaceable.filter((o) => wantedSet.has(toIsoDate(o.originalDate)));

  if (stale.length) await db.eventOccurrence.deleteMany({ where: { id: { in: stale.map((o) => o.id) } } });
  for (const o of keep) {
    const d = toIsoDate(o.originalDate);
    await db.eventOccurrence.update({
      where: { id: o.id },
      data: {
        eventDate: o.originalDate,
        startTime: event.startTime,
        endTime: event.endTime,
        ...eventInstants(d, event.startTime, event.endTime, settings),
      },
    });
  }
  if (!event.isArchived) {
    await insertEventOccurrences(db, event, settings, maxIso(start, today), until);
    await db.event.update({ where: { id: event.id }, data: { generatedUntil: fromIsoDate(until) } });
  }
}

/**
 * Makes sure every active recurring template of a user is materialised up to
 * `until` (used by the daily job and by calendar requests far in the future).
 */
export async function ensureGenerated(userId: string, until?: string): Promise<void> {
  const settings = await getSettings(userId);
  const target = until ?? horizonDate(settings);
  const targetDate = fromIsoDate(target);

  const bills = await prisma.bill.findMany({
    where: {
      userId,
      isArchived: false,
      recurrenceFrequency: { not: null },
      OR: [{ generatedUntil: null }, { generatedUntil: { lt: targetDate } }],
    },
  });
  for (const bill of bills) {
    const from = bill.generatedUntil ? addDays(toIsoDate(bill.generatedUntil), 1) : toIsoDate(bill.startDate);
    await insertBillOccurrences(prisma, bill, settings, from, target);
    await prisma.bill.update({ where: { id: bill.id }, data: { generatedUntil: targetDate } });
  }

  const events = await prisma.event.findMany({
    where: {
      userId,
      isArchived: false,
      recurrenceFrequency: { not: null },
      OR: [{ generatedUntil: null }, { generatedUntil: { lt: targetDate } }],
    },
  });
  for (const event of events) {
    const from = event.generatedUntil ? addDays(toIsoDate(event.generatedUntil), 1) : toIsoDate(event.startDate);
    await insertEventOccurrences(prisma, event, settings, from, target);
    await prisma.event.update({ where: { id: event.id }, data: { generatedUntil: targetDate } });
  }
}

/**
 * Timezone / all-day time changed: recompute UTC instants for every
 * occurrence that is still actionable. Calendar dates are left untouched.
 */
export async function recomputeInstants(userId: string): Promise<void> {
  const settings = await getSettings(userId);
  const since = fromIsoDate(addDays(todayInZone(settings.timezone), -2));

  const billOccs = await prisma.billOccurrence.findMany({
    where: { userId, status: 'PENDING', dueDate: { gte: since } },
    include: { bill: { select: { paymentMethod: true, scheduledPayDaysBefore: true } } },
  });
  const eventOccs = await prisma.eventOccurrence.findMany({
    where: { userId, status: 'UPCOMING', eventDate: { gte: since } },
  });

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const o of billOccs) {
    const time = o.dueTime ?? settings.allDayReminderTime;
    ops.push(
      prisma.billOccurrence.update({
        where: { id: o.id },
        data: {
          dueAt: localToUtc(toIsoDate(o.dueDate), time, settings.timezone),
          autopayAt:
            o.bill.paymentMethod !== 'MANUAL' && o.scheduledPayDate
              ? localToUtc(toIsoDate(o.scheduledPayDate), time, settings.timezone)
              : null,
        },
      }),
    );
  }
  for (const o of eventOccs) {
    ops.push(
      prisma.eventOccurrence.update({
        where: { id: o.id },
        data: eventInstants(toIsoDate(o.eventDate), o.startTime, o.endTime, settings),
      }),
    );
  }
  for (let i = 0; i < ops.length; i += 200) {
    await prisma.$transaction(ops.slice(i, i + 200));
  }
}
