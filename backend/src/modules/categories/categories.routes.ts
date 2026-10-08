import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { categoryCreateInput as createInput, categoryUpdateInput as updateInput, idParams, parse } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { audit } from '../../services/audit.service';

export const categoriesRouter = Router();

categoriesRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = parse(z.object({ type: z.enum(['BILL', 'EVENT']).optional() }), req.query);
  const categories = await prisma.category.findMany({
    where: { userId: me.id, ...(q.type ? { type: q.type } : {}) },
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { bills: true, events: true } } },
  });
  res.json(
    categories.map(({ _count, ...row }) => ({
      ...categoryJson(row),
      usageCount: row.type === 'BILL' ? _count.bills : _count.events,
    })),
  );
});

/** API shape: the row without owner and sync bookkeeping. */
const categoryJson = <T extends { userId: string; syncXid: bigint }>({ userId: _u, syncXid: _x, ...c }: T) => c;

categoriesRouter.post('/', async (req, res) => {
  const me = currentUser(req);
  const body = parse(createInput, req.body);
  const category = await prisma.category.create({ data: { ...body, userId: me.id } });
  await audit(prisma, { userId: me.id, entityType: 'CATEGORY', entityId: category.id, action: 'CREATED', changes: body });
  res.status(201).json(categoryJson(category));
});

categoriesRouter.patch('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const body = parse(updateInput, req.body);
  const result = await prisma.category.updateMany({ where: { id, userId: me.id }, data: body });
  if (!result.count) throw notFound('Category');
  await audit(prisma, { userId: me.id, entityType: 'CATEGORY', entityId: id, action: 'UPDATED', changes: body });
  res.json(categoryJson(await prisma.category.findUniqueOrThrow({ where: { id } })));
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
