import { DateTime } from 'luxon';
import type { NotificationChannel, Prisma, UserSettings } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { sendMail, simpleHtml } from '../lib/mailer';
import { prisma } from '../lib/prisma';
import { sendPushToUser } from '../lib/push';
import { MAX_REMINDER_MINUTES } from '../lib/validate';

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
/** "At time of event" reminders are still delivered if we're at most this late. */
const LATE_GRACE_MS = 60 * 60 * 1000;

function enabledChannels(s: UserSettings): NotificationChannel[] {
  const ch: NotificationChannel[] = [];
  if (s.inAppNotifications) ch.push('IN_APP');
  if (s.emailNotifications && env.smtpEnabled) ch.push('EMAIL');
  if (s.pushNotifications && env.pushEnabled) ch.push('PUSH');
  return ch;
}

function money(amount: string, s: UserSettings) {
  try {
    return new Intl.NumberFormat(s.locale, { style: 'currency', currency: s.currency }).format(Number(amount));
  } catch {
    return amount;
  }
}

function whenText(at: Date, allDay: boolean, s: UserSettings) {
  const dt = DateTime.fromJSDate(at).setZone(s.timezone).setLocale(s.locale);
  const day = dt.toFormat('ccc, LLL d');
  if (allDay) return day;
  return `${day} at ${dt.toFormat(s.timeFormat === '24h' ? 'HH:mm' : 'h:mm a')}`;
}

function relative(offsetMinutes: number) {
  if (offsetMinutes === 0) return 'now';
  if (offsetMinutes < 60) return `in ${offsetMinutes} minutes`;
  if (offsetMinutes < 1440) {
    const h = Math.round(offsetMinutes / 60);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(offsetMinutes / 1440);
  return d === 1 ? 'tomorrow' : `in ${d} days`;
}

/** Real lead time (when delivered late, e.g. after downtime, the text stays truthful). */
function minutesUntil(at: Date, now: Date, offset: number) {
  const scheduled = at.getTime() - offset * 60_000;
  const sendAt = Math.max(scheduled, now.getTime());
  return Math.max(0, Math.round((at.getTime() - sendAt) / 60_000));
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
  const eligible = offsets.filter((o) => at.getTime() - o * 60_000 <= now.getTime());
  if (!eligible.length || !channels.length) return [];
  const newest = Math.min(...eligible);
  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const offset of eligible) {
    const text = render(offset);
    for (const channel of channels) {
      rows.push({
        userId,
        channel,
        [occurrenceKey]: occurrenceId,
        offsetMinutes: offset,
        scheduledFor: new Date(at.getTime() - offset * 60_000),
        status: offset === newest ? 'PENDING' : 'CANCELLED',
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
        title: `${o.bill.name} is due ${relative(minutesUntil(o.dueAt, now, offset))}`,
        body: `${money(o.amount.toFixed(2), s)} due ${whenText(o.dueAt, !o.dueTime, s)}${
          o.bill.paymentMethod !== 'MANUAL' ? ' (auto-pay)' : ''
        }`,
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
        title: offset === 0 ? o.event.title : `${o.event.title} ${relative(minutesUntil(o.startAt, now, offset))}`,
        body: `${whenText(o.startAt, !o.startTime, s)}${o.event.location ? ` · ${o.event.location}` : ''}`,
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
