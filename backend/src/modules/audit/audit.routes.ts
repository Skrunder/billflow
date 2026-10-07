import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { parse } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';

/** The signed-in user's own activity / audit trail. */
export const auditRouter = Router();

auditRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = parse(
    z.object({
      entityType: z
        .enum(['USER', 'SETTINGS', 'CATEGORY', 'BILL', 'BILL_OCCURRENCE', 'EVENT', 'EVENT_OCCURRENCE', 'SESSION'])
        .optional(),
      entityId: z.string().max(64).optional(),
      before: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query,
  );
  const rows = await prisma.auditLog.findMany({
    where: {
      userId: me.id,
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
    select: { id: true, entityType: true, entityId: true, action: true, actorType: true, changes: true, createdAt: true },
  });
  res.json(rows);
});
