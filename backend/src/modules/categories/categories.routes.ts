import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { idParams, parse, trimmed } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { audit } from '../../services/audit.service';

export const categoriesRouter = Router();

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #4f46e5');

const createInput = z.object({
  name: trimmed(60).min(1),
  type: z.enum(['BILL', 'EVENT']),
  color: color.default('#6366f1'),
  icon: trimmed(40).nullish(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

const updateInput = createInput.omit({ type: true }).partial();

categoriesRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = parse(z.object({ type: z.enum(['BILL', 'EVENT']).optional() }), req.query);
  const categories = await prisma.category.findMany({
    where: { userId: me.id, ...(q.type ? { type: q.type } : {}) },
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { bills: true, events: true } } },
  });
  res.json(
    categories.map(({ _count, userId: _u, ...c }) => ({
      ...c,
      usageCount: c.type === 'BILL' ? _count.bills : _count.events,
    })),
  );
});

categoriesRouter.post('/', async (req, res) => {
  const me = currentUser(req);
  const body = parse(createInput, req.body);
  const category = await prisma.category.create({ data: { ...body, userId: me.id } });
  await audit(prisma, { userId: me.id, entityType: 'CATEGORY', entityId: category.id, action: 'CREATED', changes: body });
  res.status(201).json(category);
});

categoriesRouter.patch('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const body = parse(updateInput, req.body);
  const result = await prisma.category.updateMany({ where: { id, userId: me.id }, data: body });
  if (!result.count) throw notFound('Category');
  await audit(prisma, { userId: me.id, entityType: 'CATEGORY', entityId: id, action: 'UPDATED', changes: body });
  res.json(await prisma.category.findUniqueOrThrow({ where: { id } }));
});

/** Deleting a category never deletes bills/events — they become uncategorised. */
categoriesRouter.delete('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const result = await prisma.category.deleteMany({ where: { id, userId: me.id } });
  if (!result.count) throw notFound('Category');
  await audit(prisma, { userId: me.id, entityType: 'CATEGORY', entityId: id, action: 'DELETED' });
  res.status(204).end();
});
