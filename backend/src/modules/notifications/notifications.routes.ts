import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { badRequest, notFound } from '../../lib/errors';
import { sendMail, simpleHtml } from '../../lib/mailer';
import { prisma } from '../../lib/prisma';
import { sendPushToUser } from '../../lib/push';
import { idParams, parse } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { getSettings } from '../../services/settings.service';

export const notificationsRouter = Router();

const inApp = (userId: string) => ({ userId, channel: 'IN_APP' as const, status: 'SENT' as const });

notificationsRouter.get('/', async (req, res) => {
  const me = currentUser(req);
  const q = parse(
    z.object({
      unreadOnly: z.enum(['true', 'false']).default('false'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    req.query,
  );
  const rows = await prisma.notification.findMany({
    where: { ...inApp(me.id), ...(q.unreadOnly === 'true' ? { readAt: null } : {}) },
    orderBy: { scheduledFor: 'desc' },
    take: q.limit,
    select: {
      id: true,
      title: true,
      body: true,
      url: true,
      scheduledFor: true,
      readAt: true,
      billOccurrenceId: true,
      eventOccurrenceId: true,
    },
  });
  res.json(rows);
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const me = currentUser(req);
  res.json({ count: await prisma.notification.count({ where: { ...inApp(me.id), readAt: null } }) });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const me = currentUser(req);
  const r = await prisma.notification.updateMany({ where: { ...inApp(me.id), readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const r = await prisma.notification.updateMany({ where: { id, userId: me.id }, data: { readAt: new Date() } });
  if (!r.count) throw notFound('Notification');
  res.json({ ok: true });
});

notificationsRouter.delete('/:id', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParams, req.params);
  const r = await prisma.notification.deleteMany({ where: { id, userId: me.id } });
  if (!r.count) throw notFound('Notification');
  res.status(204).end();
});

/** Sends a test message on every enabled channel. */
notificationsRouter.post('/test', async (req, res) => {
  const me = currentUser(req);
  const settings = await getSettings(me.id);
  const result: Record<string, string> = {};
  const title = 'Test notification';
  const body = "Notifications from SKR's Bill Calendar are working.";

  if (settings.inAppNotifications) {
    await prisma.notification.create({
      data: { ...inApp(me.id), offsetMinutes: 0, scheduledFor: new Date(), sentAt: new Date(), title, body, url: '/' },
    });
    result.inApp = 'sent';
  }
  if (settings.pushNotifications) {
    result.push = env.pushEnabled ? `${await sendPushToUser(me.id, { title, body, url: '/' })} device(s)` : 'not configured on server';
  }
  if (settings.emailNotifications) {
    result.email = (await sendMail({ to: me.email, subject: title, text: body, html: simpleHtml(title, [body]) }))
      ? 'sent'
      : 'not configured on server';
  }
  res.json(result);
});

// ──────────────────────────────────────────────── web push ──

export const pushRouter = Router();

pushRouter.get('/public-key', (_req, res) => {
  res.json({ enabled: env.pushEnabled, publicKey: env.VAPID_PUBLIC_KEY ?? null });
});

const subscriptionInput = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

pushRouter.post('/subscriptions', async (req, res) => {
  const me = currentUser(req);
  if (!env.pushEnabled) throw badRequest('Push notifications are not configured on this server');
  const body = parse(subscriptionInput, req.body);
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: { userId: me.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
    create: {
      userId: me.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: req.get('user-agent')?.slice(0, 300),
    },
  });
  res.status(201).json({ ok: true });
});

pushRouter.delete('/subscriptions', async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object({ endpoint: z.string().url().max(2000) }), req.body);
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: me.id } });
  res.status(204).end();
});
