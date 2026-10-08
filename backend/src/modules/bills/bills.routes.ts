import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { fromIsoDate, todayInZone } from '@skr/core';
import { billInput, idParams, parse, type BillInputParsed, type RecurrenceInput } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { audit, diff, getHistory, requestMeta } from '../../services/audit.service';
import { generateForNewBill, regenerateBill } from '../../services/occurrence.service';
import { categorySelect, serializeBill } from '../../services/serializers';
import { getSettings } from '../../services/settings.service';

export const billsRouter = Router();

type BillInput = BillInputParsed;

function recurrenceColumns(r: RecurrenceInput) {
  return {
    recurrenceFrequency: r?.frequency ?? null,
    recurrenceInterval: r?.interval ?? 1,
    recurrenceByWeekday: r?.frequency === 'WEEKLY' ? (r.byWeekday ?? []) : [],
    recurrenceEndDate: r?.endDate ? fromIsoDate(r.endDate) : null,
    recurrenceCount: r?.count ?? null,
  };
}

async function assertCategory(userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const c = await prisma.category.findFirst({ where: { id: categoryId, userId, type: 'BILL' } });
  if (!c) throw badRequest('Unknown bill category');
}

function columns(b: BillInput, defaults: number[]) {
  return {
    name: b.name,
    description: b.description,
    notes: b.notes,
    amount: b.amount,
    amountIsEstimate: b.amountIsEstimate,
    categoryId: b.categoryId ?? null,
    paymentMethod: b.paymentMethod,
    scheduledPayDaysBefore: b.paymentMethod === 'SCHEDULED_AUTOPAY' ? (b.scheduledPayDaysBefore ?? 0) : null,
    startDate: fromIsoDate(b.startDate),
    dueTime: b.dueTime ?? null,
    reminderOffsets: b.reminderOffsets ?? defaults,
    ...recurrenceColumns(b.recurrence),
  };
}

const SCHEDULE_FIELDS = [
  'startDate',
  'dueTime',
  'paymentMethod',
  'scheduledPayDaysBefore',
  'recurrenceFrequency',
  'recurrenceInterval',
  'recurrenceByWeekday',
  'recurrenceEndDate',
  'recurrenceCount',
] as const;

// ───────────────────────────────────────────────────── routes ──

billsRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = parse(
    z.object({
      search: z.string().trim().max(100).optional(),
      categoryId: z.string().uuid().optional(),
      archived: z.enum(['true', 'false', 'all']).default('false'),
      recurring: z.enum(['true', 'false']).optional(),
    }),
    req.query,
  );
  const settings = await getSettings(me.id);
  const today = fromIsoDate(todayInZone(settings.timezone));

  const where: Prisma.BillWhereInput = {
    userId: me.id,
    ...(q.archived !== 'all' ? { isArchived: q.archived === 'true' } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.recurring ? { recurrenceFrequency: q.recurring === 'true' ? { not: null } : null } : {}),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const bills = await prisma.bill.findMany({ where, include: { category: categorySelect }, orderBy: { name: 'asc' } });
  const ids = bills.map((b) => b.id);

  const [next, overdue] = await Promise.all([
    prisma.billOccurrence.groupBy({
      by: ['billId'],
      where: { billId: { in: ids }, status: 'PENDING', dueDate: { gte: today } },
      _min: { dueDate: true },
    }),
    prisma.billOccurrence.groupBy({
      by: ['billId'],
      where: { billId: { in: ids }, status: 'PENDING', dueDate: { lt: today } },
      _count: { _all: true },
    }),
  ]);
  const nextBy = new Map(next.map((n) => [n.billId, n._min.dueDate]));
  const overdueBy = new Map(overdue.map((o) => [o.billId, o._count._all]));

  res.json(
    bills.map((b) => ({
      ...serializeBill(b),
      nextDueDate: nextBy.get(b.id)?.toISOString().slice(0, 10) ?? null,
      overdueCount: overdueBy.get(b.id) ?? 0,
    })),
  );
});

billsRouter.post('/', async (req, res) => {
  const me = currentUser(req);
  const body = parse(billInput, req.body);
  await assertCategory(me.id, body.categoryId);
  const settings = await getSettings(me.id);

  const bill = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({ data: { ...columns(body, settings.defaultBillReminders), userId: me.id } });
    await generateForNewBill(tx, created, settings);
    await audit(tx, {
      userId: me.id,
      entityType: 'BILL',
      entityId: created.id,
      action: 'CREATED',
      changes: body as Prisma.InputJsonValue,
      metadata: requestMeta(req),
    });
    return created;
  });
  const full = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { category: categorySelect } });
  res.status(201).json(serializeBill(full));
});

billsRouter.get('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const bill = await prisma.bill.findFirst({ where: { id, userId: me.id }, include: { category: categorySelect } });
  if (!bill) throw notFound('Bill');

  const stats = await prisma.billOccurrence.groupBy({
    by: ['status'],
    where: { billId: id },
    _count: { _all: true },
    _sum: { amountPaid: true },
  });
  res.json({
    ...serializeBill(bill),
    stats: Object.fromEntries(
      stats.map((s) => [s.status, { count: s._count._all, amountPaid: s._sum.amountPaid?.toFixed(2) ?? '0.00' }]),
    ),
  });
});

billsRouter.put('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const body = parse(billInput, req.body);
  await assertCategory(me.id, body.categoryId);
  const existing = await prisma.bill.findFirst({ where: { id, userId: me.id } });
  if (!existing) throw notFound('Bill');
  const settings = await getSettings(me.id);

  const data = columns(body, existing.reminderOffsets);
  const changes = diff(existing as unknown as Record<string, unknown>, data as Record<string, unknown>) as Record<string, unknown>;
  const scheduleChanged = SCHEDULE_FIELDS.some((f) => f in changes);
  const amountChanged = 'amount' in changes || 'amountIsEstimate' in changes;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.bill.update({ where: { id }, data });
    if (scheduleChanged) {
      await regenerateBill(tx, updated, settings);
    } else if (amountChanged) {
      // Propagate the new amount (or estimate flag) only to untouched, upcoming occurrences.
      await tx.billOccurrence.updateMany({
        where: {
          billId: id,
          status: 'PENDING',
          isModified: false,
          dueDate: { gte: fromIsoDate(todayInZone(settings.timezone)) },
        },
        data: { amount: updated.amount, amountIsEstimate: updated.amountIsEstimate },
      });
    }
    await audit(tx, {
      userId: me.id,
      entityType: 'BILL',
      entityId: id,
      action: 'UPDATED',
      changes: changes as Prisma.InputJsonValue,
      metadata: { ...(requestMeta(req) as object), scheduleChanged },
    });
  });

  const full = await prisma.bill.findUniqueOrThrow({ where: { id }, include: { category: categorySelect } });
  res.json(serializeBill(full));
});

/** End a series: stop generating and drop untouched future occurrences. History is kept. */
billsRouter.post('/:id/archive', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const settings = await getSettings(me.id);
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.bill.updateMany({ where: { id, userId: me.id }, data: { isArchived: true } });
    if (!r.count) return null;
    const bill = await tx.bill.findUniqueOrThrow({ where: { id } });
    if (bill.recurrenceFrequency) await regenerateBill(tx, bill, settings);
    await audit(tx, { userId: me.id, entityType: 'BILL', entityId: id, action: 'ARCHIVED' });
    return bill;
  });
  if (!result) throw notFound('Bill');
  res.json({ ok: true });
});

billsRouter.post('/:id/unarchive', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const settings = await getSettings(me.id);
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.bill.updateMany({ where: { id, userId: me.id }, data: { isArchived: false } });
    if (!r.count) return null;
    const bill = await tx.bill.findUniqueOrThrow({ where: { id } });
    if (bill.recurrenceFrequency) await regenerateBill(tx, bill, settings);
    await audit(tx, { userId: me.id, entityType: 'BILL', entityId: id, action: 'UNARCHIVED' });
    return bill;
  });
  if (!result) throw notFound('Bill');
  res.json({ ok: true });
});

/** Permanently delete the template and all of its occurrences. */
billsRouter.delete('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const bill = await prisma.bill.findFirst({ where: { id, userId: me.id } });
  if (!bill) throw notFound('Bill');
  await prisma.$transaction(async (tx) => {
    const occurrences = await tx.billOccurrence.count({ where: { billId: id } });
    await tx.bill.delete({ where: { id } });
    await audit(tx, {
      userId: me.id,
      entityType: 'BILL',
      entityId: id,
      action: 'DELETED',
      changes: { name: bill.name, amount: bill.amount.toFixed(2), occurrencesDeleted: occurrences },
      metadata: requestMeta(req),
    });
  });
  res.status(204).end();
});

billsRouter.get('/:id/history', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  res.json(await getHistory(me.id, 'BILL', id));
});
