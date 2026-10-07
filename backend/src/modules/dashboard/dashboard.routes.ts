import { Router } from 'express';
import type { BillOccurrenceStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { addDays, endOfMonth, fromIsoDate, startOfMonth, startOfWeek, summarizeBills, todayInZone, toIsoDate } from '@skr/core';
import { currentUser } from '../../middleware/auth';
import { categorySelect, serializeBillOccurrence, serializeEventOccurrence } from '../../services/serializers';
import { getSettings } from '../../services/settings.service';

export const dashboardRouter = Router();

const billInclude = { bill: { include: { category: categorySelect } } } as const;
const eventInclude = { event: { include: { category: categorySelect } } } as const;

/**
 * Totals for a date window (rules in @skr/core). Only bill occurrences
 * contribute to money totals — events are informational and never counted.
 */
function summarise(rows: { status: BillOccurrenceStatus; amount: Prisma.Decimal; amountPaid: Prisma.Decimal | null; dueDate: Date }[], today: string) {
  return summarizeBills(
    rows.map((r) => ({
      status: r.status,
      amount: r.amount.toFixed(2),
      amountPaid: r.amountPaid ? r.amountPaid.toFixed(2) : null,
      dueDate: toIsoDate(r.dueDate),
    })),
    today,
  );
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
