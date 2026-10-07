import type { Bill, Event, Prisma, UserSettings } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import {
  addDays,
  autopayInstant,
  billInstants as coreBillInstants,
  eventInstants,
  expandDates,
  fromIsoDate,
  horizonDate as coreHorizonDate,
  initialGenerationRange,
  planReconcile,
  regenerationRange,
  toIsoDate,
  todayInZone,
  wantedSlots,
  type RecurrenceSpec,
} from '@skr/core';
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

/** Core billInstants with scheduledPayDate as a DATE-column value. */
export function billInstants(
  dueDate: string,
  dueTime: string | null,
  bill: Pick<Bill, 'paymentMethod' | 'scheduledPayDaysBefore'>,
  settings: Pick<UserSettings, 'timezone' | 'allDayReminderTime'>,
) {
  const i = coreBillInstants(dueDate, dueTime, bill, settings);
  return { ...i, scheduledPayDate: i.scheduledPayDate ? fromIsoDate(i.scheduledPayDate) : null };
}

export { eventInstants };

// ───────────────────────────────────────────────── generation ──

export function horizonDate(settings: Pick<UserSettings, 'timezone'>): string {
  return coreHorizonDate(todayInZone(settings.timezone), env.OCCURRENCE_HORIZON_DAYS);
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
  const { from, to } = initialGenerationRange(
    toIsoDate(bill.startDate),
    Boolean(bill.recurrenceFrequency),
    todayInZone(settings.timezone),
    env.OCCURRENCE_HORIZON_DAYS,
  );
  await insertBillOccurrences(db, bill, settings, from, to);
  await db.bill.update({ where: { id: bill.id }, data: { generatedUntil: fromIsoDate(to) } });
}

export async function generateForNewEvent(db: Db, event: Event, settings: UserSettings) {
  const { from, to } = initialGenerationRange(
    toIsoDate(event.startDate),
    Boolean(event.recurrenceFrequency),
    todayInZone(settings.timezone),
    env.OCCURRENCE_HORIZON_DAYS,
  );
  await insertEventOccurrences(db, event, settings, from, to);
  await db.event.update({ where: { id: event.id }, data: { generatedUntil: fromIsoDate(to) } });
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

  const wanted = wantedSlots(start, billSpec(bill), bill.isArchived, today, env.OCCURRENCE_HORIZON_DAYS);
  const { keep, stale } = planReconcile(replaceable, (o) => toIsoDate(o.originalDueDate), wanted);

  if (stale.length) await db.billOccurrence.deleteMany({ where: { id: { in: stale.map((o) => o.id) } } });
  for (const o of keep) {
    const d = toIsoDate(o.originalDueDate);
    await db.billOccurrence.update({
      where: { id: o.id },
      data: { dueDate: o.originalDueDate, dueTime: bill.dueTime, amount: bill.amount, ...billInstants(d, bill.dueTime, bill, settings) },
    });
  }
  if (!bill.isArchived) {
    const { from, to } = regenerationRange(start, today, env.OCCURRENCE_HORIZON_DAYS);
    await insertBillOccurrences(db, bill, settings, from, to);
    await db.bill.update({ where: { id: bill.id }, data: { generatedUntil: fromIsoDate(to) } });
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

  const wanted = wantedSlots(start, eventSpec(event), event.isArchived, today, env.OCCURRENCE_HORIZON_DAYS);
  const { keep, stale } = planReconcile(replaceable, (o) => toIsoDate(o.originalDate), wanted);

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
    const { from, to } = regenerationRange(start, today, env.OCCURRENCE_HORIZON_DAYS);
    await insertEventOccurrences(db, event, settings, from, to);
    await db.event.update({ where: { id: event.id }, data: { generatedUntil: fromIsoDate(to) } });
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
    ops.push(
      prisma.billOccurrence.update({
        where: { id: o.id },
        data: {
          dueAt: coreBillInstants(toIsoDate(o.dueDate), o.dueTime, { paymentMethod: 'MANUAL', scheduledPayDaysBefore: null }, settings).dueAt,
          autopayAt: autopayInstant(
            o.scheduledPayDate ? toIsoDate(o.scheduledPayDate) : null,
            o.dueTime,
            o.bill.paymentMethod,
            settings,
          ),
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
