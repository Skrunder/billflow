import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { addDays, endOfMonth, fromIsoDate, startOfMonth, startOfWeek, todayInZone } from '../../lib/time';
import { currentUser } from '../../middleware/auth';
import { categorySelect, serializeBillOccurrence, serializeEventOccurrence } from '../../services/serializers';
import { getSettings } from '../../services/settings.service';

export const dashboardRouter = Router();

const billInclude = { bill: { include: { category: categorySelect } } } as const;
const eventInclude = { event: { include: { category: categorySelect } } } as const;

/**
 * Summary of a date window. Only bill occurrences contribute to money totals —
 * events are informational and never counted.
 */
function summarise(rows: { status: string; amount: Prisma.Decimal; amountPaid: Prisma.Decimal | null; dueDate: Date }[], today: string) {
  let total = new Prisma.Decimal(0);
  let paid = new Prisma.Decimal(0);
  let remaining = new Prisma.Decimal(0);
  let overdue = new Prisma.Decimal(0);
  const counts = { total: rows.length, pending: 0, completed: 0, skipped: 0, overdue: 0 };
  for (const r of rows) {
    if (r.status === 'SKIPPED') {
      counts.skipped++;
      continue;
    }
    total = total.add(r.amount);
    if (r.status === 'COMPLETED') {
      counts.completed++;
      paid = paid.add(r.amountPaid ?? r.amount);
    } else {
      remaining = remaining.add(r.amount);
      if (r.dueDate.toISOString().slice(0, 10) < today) {
        counts.overdue++;
        overdue = overdue.add(r.amount);
      } else {
        counts.pending++;
      }
    }
  }
  return {
    counts,
    total: total.toFixed(2),
    paid: paid.toFixed(2),
    remaining: remaining.toFixed(2),
    overdue: overdue.toFixed(2),
  };
}

dashboardRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const settings = await getSettings(me.id);
  const today = todayInZone(settings.timezone);
  const weekStart = startOfWeek(today, settings.weekStartsOn);
  const weekEnd = addDays(weekStart, 6);
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const d = fromIsoDate;

  const [todayBills, weekBills, monthBills, overdueBills, upcomingEvents, recentBills, recentEvents] = await Promise.all([
    prisma.billOccurrence.findMany({
      where: { userId: me.id, dueDate: d(today) },
      include: billInclude,
      orderBy: { dueAt: 'asc' },
    }),
    prisma.billOccurrence.findMany({
      where: { userId: me.id, dueDate: { gte: d(weekStart), lte: d(weekEnd) } },
      include: billInclude,
      orderBy: [{ dueDate: 'asc' }, { dueAt: 'asc' }],
    }),
    prisma.billOccurrence.findMany({
      where: { userId: me.id, dueDate: { gte: d(monthStart), lte: d(monthEnd) } },
      include: billInclude,
      orderBy: [{ dueDate: 'asc' }, { dueAt: 'asc' }],
    }),
    prisma.billOccurrence.findMany({
      where: { userId: me.id, status: 'PENDING', dueDate: { lt: d(today) } },
      include: billInclude,
      orderBy: { dueDate: 'asc' },
      take: 50,
    }),
    prisma.eventOccurrence.findMany({
      where: { userId: me.id, status: 'UPCOMING', eventDate: { gte: d(today), lte: d(addDays(today, 30)) } },
      include: eventInclude,
      orderBy: [{ eventDate: 'asc' }, { startAt: 'asc' }],
      take: 15,
    }),
    prisma.billOccurrence.findMany({
      where: { userId: me.id, status: 'COMPLETED' },
      include: billInclude,
      orderBy: { completedAt: 'desc' },
      take: 8,
    }),
    prisma.eventOccurrence.findMany({
      where: { userId: me.id, status: 'COMPLETED' },
      include: eventInclude,
      orderBy: { completedAt: 'desc' },
      take: 8,
    }),
  ]);

  const ser = (o: (typeof todayBills)[number]) => serializeBillOccurrence(o, today);
  res.json({
    today,
    timezone: settings.timezone,
    currency: settings.currency,
    range: { weekStart, weekEnd, monthStart, monthEnd },
    billsDueToday: todayBills.map(ser),
    billsDueThisWeek: weekBills.map(ser),
    billsDueThisMonth: monthBills.map(ser),
    overdueBills: overdueBills.map(ser),
    upcomingEvents: upcomingEvents.map(serializeEventOccurrence),
    recentlyCompletedBills: recentBills.map(ser),
    recentlyCompletedEvents: recentEvents.map(serializeEventOccurrence),
    summary: {
      today: summarise(todayBills, today),
      week: summarise(weekBills, today),
      month: summarise(monthBills, today),
      overdue: summarise(overdueBills, today),
    },
  });
});
