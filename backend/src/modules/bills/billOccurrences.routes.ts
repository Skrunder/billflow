import { Router, type Request } from 'express';
import type { BillOccurrence, Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { addDays, fromIsoDate, toIsoDate, todayInZone } from '@skr/core';
import { idParams, isoDate, money, optionalText, parse, timeOfDay } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { audit, diff, getHistory, requestMeta } from '../../services/audit.service';
import { billInstants, ensureGenerated } from '../../services/occurrence.service';
import { categorySelect, serializeBillOccurrence } from '../../services/serializers';
import { getSettings } from '../../services/settings.service';

/**
 * Per-occurrence operations. Every mutation here targets exactly one row by
 * primary key (scoped to the owner), so it can never change a sibling
 * occurrence of the same recurring bill.
 */
export const billOccurrencesRouter = Router();

const include = { bill: { include: { category: categorySelect } } } as const;

async function load(req: Request, id: string) {
  const me = currentUser(req);
  const occ = await prisma.billOccurrence.findFirst({ where: { id, userId: me.id }, include });
  if (!occ) throw notFound('Bill occurrence');
  return occ;
}

async function respond(req: Request, id: string) {
  const settings = await getSettings(currentUser(req).id);
  const occ = await prisma.billOccurrence.findUniqueOrThrow({ where: { id }, include });
  return serializeBillOccurrence(occ, todayInZone(settings.timezone));
}

async function transition(
  req: Request,
  occ: BillOccurrence,
  data: Prisma.BillOccurrenceUpdateInput,
  action: string,
) {
  const me = currentUser(req);
  await prisma.$transaction(async (tx) => {
    await tx.billOccurrence.update({ where: { id: occ.id }, data });
    await audit(tx, {
      userId: me.id,
      entityType: 'BILL_OCCURRENCE',
      entityId: occ.id,
      action,
      changes: diff(occ as unknown as Record<string, unknown>, data as Record<string, unknown>),
      metadata: requestMeta(req),
    });
  });
}

// ─────────────────────────────────────────────────────── list ──

billOccurrencesRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = parse(
    z.object({
      start: isoDate.optional(),
      end: isoDate.optional(),
      status: z.enum(['PENDING', 'COMPLETED', 'SKIPPED', 'OVERDUE']).optional(),
      billId: z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
      order: z.enum(['asc', 'desc']).default('asc'),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    }),
    req.query,
  );
  const settings = await getSettings(me.id);
  const today = todayInZone(settings.timezone);

  if (q.end && q.end > addDays(today, 0)) {
    await ensureGenerated(me.id, q.end < addDays(today, 5 * 366) ? q.end : addDays(today, 5 * 366));
  }

  const where: Prisma.BillOccurrenceWhereInput = { userId: me.id };
  if (q.billId) where.billId = q.billId;
  if (q.categoryId) where.bill = { categoryId: q.categoryId };
  const dueDate: Prisma.DateTimeFilter = {};
  if (q.start) dueDate.gte = fromIsoDate(q.start);
  if (q.end) dueDate.lte = fromIsoDate(q.end);
  if (q.status === 'OVERDUE') {
    where.status = 'PENDING';
    dueDate.lt = fromIsoDate(today);
  } else if (q.status) {
    where.status = q.status;
  }
  if (Object.keys(dueDate).length) where.dueDate = dueDate;

  const rows = await prisma.billOccurrence.findMany({
    where,
    include,
    orderBy: [{ dueDate: q.order }, { dueAt: q.order }],
    take: q.limit,
  });
  res.json(rows.map((o) => serializeBillOccurrence(o, today)));
});

billOccurrencesRouter.get('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  await load(req, id);
  res.json(await respond(req, id));
});

billOccurrencesRouter.get('/:id/history', async (req, res) => {
  const { id } = parse(idParams, req.params);
  await load(req, id);
  res.json(await getHistory(currentUser(req).id, 'BILL_OCCURRENCE', id));
});

// ──────────────────────────────────────────────────── mutate ──

/** Edit this single occurrence (reschedule, change amount, notes). */
billOccurrencesRouter.patch('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(
    z.object({
      dueDate: isoDate.optional(),
      dueTime: timeOfDay.nullish(),
      amount: money.optional(),
      notes: optionalText(5000).optional(),
      confirmationNumber: optionalText(120).optional(),
      amountPaid: money.nullish(),
    }),
    req.body,
  );
  const occ = await load(req, id);
  const settings = await getSettings(currentUser(req).id);

  const dueDate = body.dueDate ?? toIsoDate(occ.dueDate);
  const dueTime = body.dueTime === undefined ? occ.dueTime : body.dueTime;
  const instants = billInstants(dueDate, dueTime, occ.bill, settings);
  const data: Prisma.BillOccurrenceUpdateInput = {
    dueDate: fromIsoDate(dueDate),
    dueTime,
    dueAt: instants.dueAt,
    scheduledPayDate: instants.scheduledPayDate,
    autopayAt: instants.autopayAt,
    isModified: true,
  };
  if (body.amount !== undefined) data.amount = body.amount;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.confirmationNumber !== undefined) data.confirmationNumber = body.confirmationNumber;
  if (body.amountPaid !== undefined) data.amountPaid = body.amountPaid;

  await transition(req, occ, data, 'UPDATED');
  res.json(await respond(req, id));
});

billOccurrencesRouter.post('/:id/complete', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(
    z
      .object({
        completedAt: z.string().datetime({ offset: true }).optional(),
        amountPaid: money.nullish(),
        confirmationNumber: optionalText(120),
        notes: optionalText(5000).optional(),
      })
      .default({}),
    req.body ?? {},
  );
  const occ = await load(req, id);
  if (occ.status === 'COMPLETED') throw badRequest('This occurrence is already completed');
  const completedAt = body.completedAt ? new Date(body.completedAt) : new Date();
  if (completedAt.getTime() > Date.now() + 5 * 60_000) throw badRequest('Completion date cannot be in the future');

  await transition(
    req,
    occ,
    {
      status: 'COMPLETED',
      completedAt,
      amountPaid: body.amountPaid ?? occ.amount,
      confirmationNumber: body.confirmationNumber ?? occ.confirmationNumber,
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
    'COMPLETED',
  );
  res.json(await respond(req, id));
});

billOccurrencesRouter.post('/:id/skip', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(z.object({ notes: optionalText(5000).optional() }).default({}), req.body ?? {});
  const occ = await load(req, id);
  if (occ.status === 'SKIPPED') throw badRequest('This occurrence is already skipped');
  await transition(
    req,
    occ,
    { status: 'SKIPPED', completedAt: null, amountPaid: null, ...(body.notes !== undefined ? { notes: body.notes } : {}) },
    'SKIPPED',
  );
  res.json(await respond(req, id));
});

/** Undo complete / skip — back to pending (shows as overdue if past due). */
billOccurrencesRouter.post('/:id/reopen', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const occ = await load(req, id);
  if (occ.status === 'PENDING') throw badRequest('This occurrence is already pending');
  // Clearing autopayAt stops the auto-pay job from immediately re-completing it.
  await transition(req, occ, { status: 'PENDING', completedAt: null, amountPaid: null, autopayAt: null }, 'REOPENED');
  res.json(await respond(req, id));
});
