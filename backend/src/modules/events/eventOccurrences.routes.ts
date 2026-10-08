import { Router, type Request } from 'express';
import type { EventOccurrence, Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { addDays, fromIsoDate, toIsoDate, todayInZone } from '@skr/core';
import { idParams, isoDate, optionalText, parse, timeOfDay } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { audit, diff, getHistory, requestMeta } from '../../services/audit.service';
import { ensureGenerated, eventInstants } from '../../services/occurrence.service';
import { categorySelect, serializeEventOccurrence } from '../../services/serializers';
import { getSettings } from '../../services/settings.service';

/**
 * Per-occurrence operations for events. Each mutation updates exactly one row
 * by primary key — sibling occurrences are never affected.
 */
export const eventOccurrencesRouter = Router();

const include = { event: { include: { category: categorySelect } } } as const;

async function load(req: Request, id: string) {
  const occ = await prisma.eventOccurrence.findFirst({ where: { id, userId: currentUser(req).id }, include });
  if (!occ) throw notFound('Event occurrence');
  return occ;
}

async function respond(id: string) {
  return serializeEventOccurrence(await prisma.eventOccurrence.findUniqueOrThrow({ where: { id }, include }));
}

async function transition(req: Request, occ: EventOccurrence, data: Prisma.EventOccurrenceUpdateInput, action: string) {
  const me = currentUser(req);
  await prisma.$transaction(async (tx) => {
    // Status changes are stamped so sync can tell a completion from a plain edit.
    await tx.eventOccurrence.update({ where: { id: occ.id }, data: 'status' in data ? { ...data, statusChangedAt: new Date() } : data });
    await audit(tx, {
      userId: me.id,
      entityType: 'EVENT_OCCURRENCE',
      entityId: occ.id,
      action,
      changes: diff(occ as unknown as Record<string, unknown>, data as Record<string, unknown>),
      metadata: requestMeta(req),
    });
  });
}

eventOccurrencesRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = parse(
    z.object({
      start: isoDate.optional(),
      end: isoDate.optional(),
      status: z.enum(['UPCOMING', 'COMPLETED', 'CANCELLED']).optional(),
      eventId: z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
      order: z.enum(['asc', 'desc']).default('asc'),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    }),
    req.query,
  );
  const settings = await getSettings(me.id);
  const today = todayInZone(settings.timezone);
  if (q.end && q.end > today) {
    await ensureGenerated(me.id, q.end < addDays(today, 5 * 366) ? q.end : addDays(today, 5 * 366));
  }
  const where: Prisma.EventOccurrenceWhereInput = { userId: me.id };
  if (q.eventId) where.eventId = q.eventId;
  if (q.categoryId) where.event = { categoryId: q.categoryId };
  if (q.status) where.status = q.status;
  if (q.start || q.end) {
    where.eventDate = {
      ...(q.start ? { gte: fromIsoDate(q.start) } : {}),
      ...(q.end ? { lte: fromIsoDate(q.end) } : {}),
    };
  }
  const rows = await prisma.eventOccurrence.findMany({
    where,
    include,
    orderBy: [{ eventDate: q.order }, { startAt: q.order }],
    take: q.limit,
  });
  res.json(rows.map(serializeEventOccurrence));
});

eventOccurrencesRouter.get('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  await load(req, id);
  res.json(await respond(id));
});

eventOccurrencesRouter.get('/:id/history', async (req, res) => {
  const { id } = parse(idParams, req.params);
  await load(req, id);
  res.json(await getHistory(currentUser(req).id, 'EVENT_OCCURRENCE', id));
});

eventOccurrencesRouter.patch('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(
    z.object({
      eventDate: isoDate.optional(),
      startTime: timeOfDay.nullish(),
      endTime: timeOfDay.nullish(),
      notes: optionalText(5000).optional(),
    }),
    req.body,
  );
  const occ = await load(req, id);
  const settings = await getSettings(currentUser(req).id);
  const eventDate = body.eventDate ?? toIsoDate(occ.eventDate);
  const startTime = body.startTime === undefined ? occ.startTime : body.startTime;
  let endTime = body.endTime === undefined ? occ.endTime : body.endTime;
  if (!startTime) endTime = null;

  const data: Prisma.EventOccurrenceUpdateInput = {
    eventDate: fromIsoDate(eventDate),
    startTime,
    endTime,
    ...eventInstants(eventDate, startTime, endTime, settings),
    isModified: true,
  };
  if (body.notes !== undefined) data.notes = body.notes;
  await transition(req, occ, data, 'UPDATED');
  res.json(await respond(id));
});

eventOccurrencesRouter.post('/:id/complete', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(z.object({ notes: optionalText(5000).optional() }).default({}), req.body ?? {});
  const occ = await load(req, id);
  if (occ.status === 'COMPLETED') throw badRequest('This occurrence is already completed');
  await transition(
    req,
    occ,
    { status: 'COMPLETED', completedAt: new Date(), cancelledAt: null, ...(body.notes !== undefined ? { notes: body.notes } : {}) },
    'COMPLETED',
  );
  res.json(await respond(id));
});

eventOccurrencesRouter.post('/:id/cancel', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const body = parse(z.object({ notes: optionalText(5000).optional() }).default({}), req.body ?? {});
  const occ = await load(req, id);
  if (occ.status === 'CANCELLED') throw badRequest('This occurrence is already cancelled');
  await transition(
    req,
    occ,
    { status: 'CANCELLED', cancelledAt: new Date(), completedAt: null, ...(body.notes !== undefined ? { notes: body.notes } : {}) },
    'CANCELLED',
  );
  res.json(await respond(id));
});

eventOccurrencesRouter.post('/:id/reopen', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const occ = await load(req, id);
  if (occ.status === 'UPCOMING') throw badRequest('This occurrence is already upcoming');
  await transition(req, occ, { status: 'UPCOMING', completedAt: null, cancelledAt: null }, 'REOPENED');
  res.json(await respond(id));
});
