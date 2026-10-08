import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { idParams, parse } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { revokeDevice } from '../auth/auth.service';
import { audit } from '../../services/audit.service';
import { DEFAULT_PULL_LIMIT, parseCursor, pull, push } from '../../services/sync.service';

/** Sync for the Android app. See docs/API.md, "Sync". */
export const syncRouter = Router();

syncRouter.get('/pull', async (req, res) => {
  const me = currentUser(req);
  const q = parse(z.object({ since: z.string().max(20).optional(), limit: z.coerce.number().int().min(100).max(5000).default(DEFAULT_PULL_LIMIT) }), req.query);
  res.json(await pull(me.id, parseCursor(q.since), q.limit));
});

syncRouter.post('/push', async (req, res) => {
  res.json(await push(currentUser(req).id, req.body));
});

/** Phones signed in to this account (for "signed-in devices" in Settings). */
syncRouter.get('/devices', async (req, res) => {
  const devices = await prisma.device.findMany({
    where: { userId: currentUser(req).id, revokedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, platform: true, lastSyncAt: true, createdAt: true },
  });
  res.json(devices);
});

syncRouter.delete('/devices/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const device = await prisma.device.findFirst({ where: { id, userId: me.id, revokedAt: null } });
  if (!device) throw notFound('Device');
  await revokeDevice(device.sessionFamilyId);
  await audit(prisma, { userId: me.id, entityType: 'USER', entityId: me.id, action: 'DEVICE_REMOVED', metadata: { deviceId: id } });
  res.status(204).end();
});
