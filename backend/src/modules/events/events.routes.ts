import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { fromIsoDate, todayInZone } from '../../lib/time';
import {
  idParams,
  isoDate,
  optionalText,
  parse,
  recurrenceInput,
  reminderOffsets,
  timeOfDay,
  trimmed,
  type RecurrenceInput,
} from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { audit, diff, getHistory, requestMeta } from '../../services/audit.service';
import { generateForNewEvent, regenerateEvent } from '../../services/occurrence.service';
import { categorySelect, serializeEvent } from '../../services/serializers';
import { getSettings } from '../../services/settings.service';

/**
 * Calendar events: informational only. They are never part of any bill total
 * or financial report.
 */
export const eventsRouter = Router();

const eventInput = z
  .object({
    title: trimmed(120).min(1),
    description: optionalText(1000),
    notes: optionalText(5000),
    location: optionalText(200),
    categoryId: z.string().uuid().nullish(),
    startDate: isoDate,
    startTime: timeOfDay.nullish(),
    endTime: timeOfDay.nullish(),
    recurrence: recurrenceInput,
    reminderOffsets: reminderOffsets.optional(),
  })
  .refine((e) => !e.endTime || e.startTime, { message: 'An end time needs a start time', path: ['endTime'] })
  .refine((e) => !e.recurrence?.endDate || e.recurrence.endDate >= e.startDate, {
    message: 'Recurrence end date must be on or after the start date',
    path: ['recurrence', 'endDate'],
  });

type EventInput = z.infer<typeof eventInput>;

function recurrenceColumns(r: RecurrenceInput) {
  return {
    recurrenceFrequency: r?.frequency ?? null,
    recurrenceInterval: r?.interval ?? 1,
    recurrenceByWeekday: r?.frequency === 'WEEKLY' ? (r.byWeekday ?? []) : [],
    recurrenceEndDate: r?.endDate ? fromIsoDate(r.endDate) : null,
    recurrenceCount: r?.count ?? null,
  };
}

function columns(e: EventInput, defaults: number[]) {
  return {
    title: e.title,
    description: e.description,
    notes: e.notes,
    location: e.location,
    categoryId: e.categoryId ?? null,
    startDate: fromIsoDate(e.startDate),
    startTime: e.startTime ?? null,
    endTime: e.startTime ? (e.endTime ?? null) : null,
    reminderOffsets: e.reminderOffsets ?? defaults,
    ...recurrenceColumns(e.recurrence),
  };
}

async function assertCategory(userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const c = await prisma.category.findFirst({ where: { id: categoryId, userId, type: 'EVENT' } });
  if (!c) throw badRequest('Unknown event category');
}

const SCHEDULE_FIELDS = [
  'startDate',
  'startTime',
  'endTime',
  'recurrenceFrequency',
  'recurrenceInterval',
  'recurrenceByWeekday',
  'recurrenceEndDate',
  'recurrenceCount',
] as const;

eventsRouter.get('/', async (req, res) => {
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
  const where: Prisma.EventWhereInput = {
    userId: me.id,
    ...(q.archived !== 'all' ? { isArchived: q.archived === 'true' } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.recurring ? { recurrenceFrequency: q.recurring === 'true' ? { not: null } : null } : {}),
    ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const events = await prisma.event.findMany({ where, include: { category: categorySelect }, orderBy: { title: 'asc' } });
  const next = await prisma.eventOccurrence.groupBy({
    by: ['eventId'],
    where: { eventId: { in: events.map((e) => e.id) }, status: 'UPCOMING', eventDate: { gte: today } },
    _min: { eventDate: true },
  });
  const nextBy = new Map(next.map((n) => [n.eventId, n._min.eventDate]));
  res.json(events.map((e) => ({ ...serializeEvent(e), nextDate: nextBy.get(e.id)?.toISOString().slice(0, 10) ?? null })));
});

eventsRouter.post('/', async (req, res) => {
  const me = currentUser(req);
  const body = parse(eventInput, req.body);
  await assertCategory(me.id, body.categoryId);
  const settings = await getSettings(me.id);
  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({ data: { ...columns(body, settings.defaultEventReminders), userId: me.id } });
    await generateForNewEvent(tx, created, settings);
    await audit(tx, {
      userId: me.id,
      entityType: 'EVENT',
      entityId: created.id,
      action: 'CREATED',
      changes: body as Prisma.InputJsonValue,
      metadata: requestMeta(req),
    });
    return created;
  });
  const full = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { category: categorySelect } });
  res.status(201).json(serializeEvent(full));
});

eventsRouter.get('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const event = await prisma.event.findFirst({ where: { id, userId: me.id }, include: { category: categorySelect } });
  if (!event) throw notFound('Event');
  const stats = await prisma.eventOccurrence.groupBy({ by: ['status'], where: { eventId: id }, _count: { _all: true } });
  res.json({ ...serializeEvent(event), stats: Object.fromEntries(stats.map((s) => [s.status, { count: s._count._all }])) });
});

eventsRouter.put('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const body = parse(eventInput, req.body);
  await assertCategory(me.id, body.categoryId);
  const existing = await prisma.event.findFirst({ where: { id, userId: me.id } });
  if (!existing) throw notFound('Event');
  const settings = await getSettings(me.id);

  const data = columns(body, existing.reminderOffsets);
  const changes = diff(existing as unknown as Record<string, unknown>, data as Record<string, unknown>) as Record<string, unknown>;
  const scheduleChanged = SCHEDULE_FIELDS.some((f) => f in changes);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({ where: { id }, data });
    if (scheduleChanged) await regenerateEvent(tx, updated, settings);
    await audit(tx, {
      userId: me.id,
      entityType: 'EVENT',
      entityId: id,
      action: 'UPDATED',
      changes: changes as Prisma.InputJsonValue,
      metadata: { ...(requestMeta(req) as object), scheduleChanged },
    });
  });
  const full = await prisma.event.findUniqueOrThrow({ where: { id }, include: { category: categorySelect } });
  res.json(serializeEvent(full));
});

for (const [path, archived] of [
  ['/:id/archive', true],
  ['/:id/unarchive', false],
] as const) {
  eventsRouter.post(path, async (req, res) => {
    const me = currentUser(req);
    const { id } = parse(idParams, req.params);
    const settings = await getSettings(me.id);
    const result = await prisma.$transaction(async (tx) => {
      const r = await tx.event.updateMany({ where: { id, userId: me.id }, data: { isArchived: archived } });
      if (!r.count) return null;
      const event = await tx.event.findUniqueOrThrow({ where: { id } });
      if (event.recurrenceFrequency) await regenerateEvent(tx, event, settings);
      await audit(tx, { userId: me.id, entityType: 'EVENT', entityId: id, action: archived ? 'ARCHIVED' : 'UNARCHIVED' });
      return event;
    });
    if (!result) throw notFound('Event');
    res.json({ ok: true });
  });
}

eventsRouter.delete('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const event = await prisma.event.findFirst({ where: { id, userId: me.id } });
  if (!event) throw notFound('Event');
  await prisma.$transaction(async (tx) => {
    const occurrences = await tx.eventOccurrence.count({ where: { eventId: id } });
    await tx.event.delete({ where: { id } });
    await audit(tx, {
      userId: me.id,
      entityType: 'EVENT',
      entityId: id,
      action: 'DELETED',
      changes: { title: event.title, occurrencesDeleted: occurrences },
      metadata: requestMeta(req),
    });
  });
  res.status(204).end();
});

eventsRouter.get('/:id/history', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  res.json(await getHistory(me.id, 'EVENT', id));
});
