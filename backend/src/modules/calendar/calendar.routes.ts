import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { addDays, billDisplayAmount, daysBetween, fromIsoDate, toIsoDate, todayInZone } from '@skr/core';
import { dateRangeQuery, parse } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { ensureGenerated } from '../../services/occurrence.service';
import { categorySelect, effectiveBillStatus } from '../../services/serializers';
import { getSettings } from '../../services/settings.service';

/** Unified bills + events feed for the calendar views. */
export const calendarRouter = Router();

const MAX_RANGE_DAYS = 400;

/** What was paid once completed, otherwise the (possibly estimated) amount due. */
function calendarAmount(o: { status: string; amount: { toFixed(n: number): string }; amountPaid: { toFixed(n: number): string } | null; amountIsEstimate: boolean }) {
  const d = billDisplayAmount({ status: o.status, amount: o.amount.toFixed(2), amountPaid: o.amountPaid?.toFixed(2) ?? null, amountIsEstimate: o.amountIsEstimate });
  return { amount: d.amount, amountIsEstimate: d.estimated };
}

calendarRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = parse(
    dateRangeQuery.and(
      z.object({
        type: z.enum(['all', 'bills', 'events']).default('all'),
        includeCompleted: z.enum(['true', 'false']).default('true'),
      }),
    ),
    req.query,
  );
  if (daysBetween(q.start, q.end) > MAX_RANGE_DAYS) throw badRequest(`Range cannot exceed ${MAX_RANGE_DAYS} days`);

  const settings = await getSettings(me.id);
  const today = todayInZone(settings.timezone);
  const cap = addDays(today, 5 * 366);
  if (q.end > today) await ensureGenerated(me.id, q.end < cap ? q.end : cap);

  const range = { gte: fromIsoDate(q.start), lte: fromIsoDate(q.end) };
  const showDone = q.includeCompleted === 'true';

  const [bills, events] = await Promise.all([
    q.type === 'events'
      ? []
      : prisma.billOccurrence.findMany({
          where: { userId: me.id, dueDate: range, ...(showDone ? {} : { status: 'PENDING' }) },
          include: { bill: { include: { category: categorySelect } } },
          orderBy: [{ dueDate: 'asc' }, { dueAt: 'asc' }],
        }),
    q.type === 'bills'
      ? []
      : prisma.eventOccurrence.findMany({
          where: { userId: me.id, eventDate: range, ...(showDone ? {} : { status: 'UPCOMING' }) },
          include: { event: { include: { category: categorySelect } } },
          orderBy: [{ eventDate: 'asc' }, { startAt: 'asc' }],
        }),
  ]);

  const items = [
    ...bills.map((o) => ({
      id: `bill:${o.id}`,
      kind: 'bill' as const,
      occurrenceId: o.id,
      templateId: o.billId,
      title: o.bill.name,
      date: toIsoDate(o.dueDate),
      allDay: !o.dueTime,
      start: o.dueTime ? o.dueAt.toISOString() : toIsoDate(o.dueDate),
      end: null as string | null,
      status: effectiveBillStatus(o, today),
      ...calendarAmount(o),
      paymentMethod: o.bill.paymentMethod,
      isRecurring: Boolean(o.bill.recurrenceFrequency),
      color: o.bill.category?.color ?? null,
      categoryName: o.bill.category?.name ?? null,
    })),
    ...events.map((o) => ({
      id: `event:${o.id}`,
      kind: 'event' as const,
      occurrenceId: o.id,
      templateId: o.eventId,
      title: o.event.title,
      date: toIsoDate(o.eventDate),
      allDay: !o.startTime,
      start: o.startTime ? o.startAt.toISOString() : toIsoDate(o.eventDate),
      end: o.endAt ? o.endAt.toISOString() : null,
      status: o.status,
      amount: null,
      amountIsEstimate: false,
      paymentMethod: null,
      isRecurring: Boolean(o.event.recurrenceFrequency),
      color: o.event.category?.color ?? null,
      categoryName: o.event.category?.name ?? null,
    })),
  ];
  res.json({ timezone: settings.timezone, today, items });
});
