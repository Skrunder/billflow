import { Router } from 'express';
import { z } from 'zod';
import { badRequest, unauthorized } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { parse, password, settingsInput, trimmed } from '../../lib/validate';
import { currentUser } from '../../middleware/auth';
import { audit, diff, requestMeta } from '../../services/audit.service';
import { recomputeInstants } from '../../services/occurrence.service';
import { getSettings } from '../../services/settings.service';
import { serializeBill, serializeBillOccurrence, serializeEvent, serializeEventOccurrence } from '../../services/serializers';
import { todayInZone } from '@skr/core';
import { clearAuthCookies, hashPassword, publicUser, revokeAllSessions, verifyPassword } from '../auth/auth.service';

export const usersRouter = Router();

function serializeSettings(s: Awaited<ReturnType<typeof getSettings>>) {
  const { userId: _userId, updatedAt, ...rest } = s;
  return { ...rest, updatedAt: updatedAt.toISOString() };
}

usersRouter.get('/me', async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(req).id } });
  const settings = await getSettings(user.id);
  res.json({ user: publicUser(user), settings: serializeSettings(settings) });
});

usersRouter.patch('/me', async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object({ displayName: trimmed(80).min(1) }), req.body);
  const user = await prisma.user.update({ where: { id: me.id }, data: body });
  await audit(prisma, { userId: me.id, entityType: 'USER', entityId: me.id, action: 'PROFILE_UPDATED', changes: body });
  res.json({ user: publicUser(user) });
});

usersRouter.post('/me/password', async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
  await revokeAllSessions(me.id);
  await audit(prisma, { userId: me.id, entityType: 'USER', entityId: me.id, action: 'PASSWORD_CHANGED', metadata: requestMeta(req) });
  clearAuthCookies(res);
  res.json({ ok: true, reauthenticate: true });
});

usersRouter.delete('/me', async (req, res) => {
  const me = currentUser(req);
  const body = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await verifyPassword(body.password, user.passwordHash))) throw unauthorized('Password is incorrect');
  if (user.role === 'ADMIN' && (await prisma.user.count({ where: { role: 'ADMIN', isActive: true } })) <= 1) {
    const others = await prisma.user.count({ where: { id: { not: me.id } } });
    if (others > 0) throw badRequest('Promote another administrator before deleting the only admin account');
  }
  await prisma.user.delete({ where: { id: me.id } }); // cascades to all user data
  clearAuthCookies(res);
  res.status(204).end();
});

/** Full JSON export of the user's data (portable personal backup). */
usersRouter.get('/me/export', async (req, res) => {
  const me = currentUser(req);
  const settings = await getSettings(me.id);
  const today = todayInZone(settings.timezone);
  const [user, categories, bills, billOccurrences, events, eventOccurrences] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: me.id } }),
    prisma.category.findMany({ where: { userId: me.id }, orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }] }),
    prisma.bill.findMany({ where: { userId: me.id }, include: { category: true } }),
    prisma.billOccurrence.findMany({ where: { userId: me.id }, include: { bill: { include: { category: true } } }, orderBy: { dueDate: 'asc' } }),
    prisma.event.findMany({ where: { userId: me.id }, include: { category: true } }),
    prisma.eventOccurrence.findMany({ where: { userId: me.id }, include: { event: { include: { category: true } } }, orderBy: { eventDate: 'asc' } }),
  ]);
  res.setHeader('Content-Disposition', `attachment; filename="bill-calendar-export-${today}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    format: 'skr-bill-calendar-export@1',
    user: publicUser(user),
    settings: serializeSettings(settings),
    categories,
    bills: bills.map(serializeBill),
    billOccurrences: billOccurrences.map((o) => serializeBillOccurrence(o, today)),
    events: events.map(serializeEvent),
    eventOccurrences: eventOccurrences.map(serializeEventOccurrence),
  });
});

// ─────────────────────────────────────────────────── settings ──

usersRouter.get('/settings', async (req, res) => {
  res.json(serializeSettings(await getSettings(currentUser(req).id)));
});

usersRouter.put('/settings', async (req, res) => {
  const me = currentUser(req);
  const body = parse(settingsInput, req.body);
  const before = await getSettings(me.id);
  const after = await prisma.userSettings.update({ where: { userId: me.id }, data: body });
  await audit(prisma, {
    userId: me.id,
    entityType: 'SETTINGS',
    entityId: me.id,
    action: 'SETTINGS_UPDATED',
    changes: diff(before as unknown as Record<string, unknown>, body as Record<string, unknown>),
  });
  if (before.timezone !== after.timezone || before.allDayReminderTime !== after.allDayReminderTime) {
    await recomputeInstants(me.id);
  }
  res.json(serializeSettings(after));
});
