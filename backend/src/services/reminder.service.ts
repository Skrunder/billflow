import type { NotificationChannel, Prisma, UserSettings } from '@prisma/client';
import {
  billReminderText,
  eventReminderText,
  LATE_GRACE_MS,
  MAX_REMINDER_MINUTES,
  reminderTime,
  selectDueReminders,
  type ReminderLocale,
} from '@skr/core';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { sendMail, simpleHtml } from '../lib/mailer';
import { prisma } from '../lib/prisma';
import { sendPushToUser } from '../lib/push';

/**
 * Reminder pipeline (runs every minute):
 *   1. plan:     for each actionable occurrence whose reminder time has been
 *                reached, insert Notification rows (idempotent via unique keys)
 *   2. dispatch: deliver PENDING notifications on their channel
 *
 * If several reminder offsets became due at once (e.g. a bill created the day
 * before it's due with a 7-day reminder, or after downtime), only the most
 * recent one is delivered; the older ones are recorded as CANCELLED.
 */

const MAX_ATTEMPTS = 3;

function enabledChannels(s: UserSettings): NotificationChannel[] {
  const ch: NotificationChannel[] = [];
  if (s.inAppNotifications) ch.push('IN_APP');
  if (s.emailNotifications && env.smtpEnabled) ch.push('EMAIL');
  if (s.pushNotifications && env.pushEnabled) ch.push('PUSH');
  return ch;
}

function reminderLocale(s: UserSettings): ReminderLocale {
  return { timezone: s.timezone, locale: s.locale, currency: s.currency, timeFormat: s.timeFormat === '24h' ? '24h' : '12h' };
}

function plan(
  occurrenceKey: 'billOccurrenceId' | 'eventOccurrenceId',
  occurrenceId: string,
  userId: string,
  at: Date,
  offsets: number[],
  now: Date,
  channels: NotificationChannel[],
  render: (offset: number) => { title: string; body: string; url: string },
): Prisma.NotificationCreateManyInput[] {
  const { due, deliver } = selectDueReminders(at, offsets, now);
  if (!due.length || !channels.length) return [];
  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const offset of due) {
    const text = render(offset);
    for (const channel of channels) {
      rows.push({
        userId,
        channel,
        [occurrenceKey]: occurrenceId,
        offsetMinutes: offset,
        scheduledFor: reminderTime(at, offset),
        status: offset === deliver ? 'PENDING' : 'CANCELLED',
        ...text,
      });
    }
  }
  return rows;
}

export async function planReminders(now = new Date()): Promise<number> {
  const windowStart = new Date(now.getTime() - LATE_GRACE_MS);
  const windowEnd = new Date(now.getTime() + MAX_REMINDER_MINUTES * 60_000);
  const rows: Prisma.NotificationCreateManyInput[] = [];

  const bills = await prisma.billOccurrence.findMany({
    where: {
      status: 'PENDING',
      dueAt: { gte: windowStart, lte: windowEnd },
      bill: { reminderOffsets: { isEmpty: false } },
      user: { isActive: true },
    },
    include: { bill: true, user: { include: { settings: true } } },
  });
  for (const o of bills) {
    const s = o.user.settings;
    if (!s) continue;
    rows.push(
      ...plan('billOccurrenceId', o.id, o.userId, o.dueAt, o.bill.reminderOffsets, now, enabledChannels(s), (offset) => ({
        ...billReminderText(
          { name: o.bill.name, amount: o.amount.toFixed(2), amountIsEstimate: o.amountIsEstimate, dueAt: o.dueAt, allDay: !o.dueTime, paymentMethod: o.bill.paymentMethod },
          offset,
          now,
          reminderLocale(s),
        ),
        url: `/bills/${o.billId}?occurrence=${o.id}`,
      })),
    );
  }

  const events = await prisma.eventOccurrence.findMany({
    where: {
      status: 'UPCOMING',
      startAt: { gte: windowStart, lte: windowEnd },
      event: { reminderOffsets: { isEmpty: false } },
      user: { isActive: true },
    },
    include: { event: true, user: { include: { settings: true } } },
  });
  for (const o of events) {
    const s = o.user.settings;
    if (!s) continue;
    rows.push(
      ...plan('eventOccurrenceId', o.id, o.userId, o.startAt, o.event.reminderOffsets, now, enabledChannels(s), (offset) => ({
        ...eventReminderText(
          { title: o.event.title, startAt: o.startAt, allDay: !o.startTime, location: o.event.location },
          offset,
          now,
          reminderLocale(s),
        ),
        url: `/events/${o.eventId}?occurrence=${o.id}`,
      })),
    );
  }

  if (!rows.length) return 0;
  const res = await prisma.notification.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}

export async function dispatchReminders(now = new Date()): Promise<number> {
  const due = await prisma.notification.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: MAX_ATTEMPTS }, scheduledFor: { lte: now } },
    include: {
      user: { select: { email: true } },
      billOccurrence: { select: { status: true } },
      eventOccurrence: { select: { status: true } },
    },
    orderBy: { scheduledFor: 'asc' },
    take: 500,
  });

  let sent = 0;
  for (const n of due) {
    // Claim the row (safe with multiple API replicas).
    const claimed = await prisma.notification.updateMany({
      where: { id: n.id, attempts: n.attempts, status: n.status },
      data: { attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;

    const stillActionable =
      (n.billOccurrence && n.billOccurrence.status === 'PENDING') ||
      (n.eventOccurrence && n.eventOccurrence.status === 'UPCOMING');
    if (!stillActionable) {
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'CANCELLED' } });
      continue;
    }

    try {
      switch (n.channel) {
        case 'IN_APP':
          break; // stored row *is* the in-app notification
        case 'EMAIL': {
          const ok = await sendMail({
            to: n.user.email,
            subject: n.title,
            text: `${n.body}\n\n${env.APP_URL}${n.url ?? ''}`,
            html: simpleHtml(n.title, [n.body], { href: `${env.APP_URL}${n.url ?? ''}`, label: 'Open Bill Calendar' }),
          });
          if (!ok) throw new Error('SMTP not configured');
          break;
        }
        case 'PUSH': {
          const delivered = await sendPushToUser(n.userId, {
            title: n.title,
            body: n.body,
            url: n.url ?? '/',
            tag: n.billOccurrenceId ?? n.eventOccurrenceId ?? n.id,
          });
          if (!delivered) throw new Error('No reachable push subscriptions');
          break;
        }
        case 'SMS':
          throw new Error('SMS delivery is not implemented yet');
      }
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: new Date(), lastError: null } });
      sent++;
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      await prisma.notification.update({ where: { id: n.id }, data: { status: 'FAILED', lastError: message } });
      logger.warn({ notificationId: n.id, channel: n.channel, err: message }, 'reminder delivery failed');
    }
  }
  return sent;
}

/** Remove delivered/cancelled notifications older than 180 days. */
export async function pruneNotifications(now = new Date()) {
  const cutoff = new Date(now.getTime() - 180 * 24 * 3600 * 1000);
  await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff }, status: { not: 'PENDING' } } });
}
