import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { processAutopay } from './autopay.service';
import { ensureGenerated } from './occurrence.service';
import { dispatchReminders, planReminders, pruneNotifications } from './reminder.service';
import { pruneSyncData } from './sync.service';

/**
 * In-process background jobs. All jobs are idempotent, so running more than
 * one API replica is safe (work may just be attempted twice).
 */

const timers: NodeJS.Timeout[] = [];
const running = new Set<string>();

async function runJob(name: string, fn: () => Promise<unknown>) {
  if (running.has(name)) return; // never overlap with ourselves
  running.add(name);
  const started = Date.now();
  try {
    const result = await fn();
    logger.debug({ job: name, ms: Date.now() - started, result }, 'job finished');
  } catch (err) {
    logger.error({ job: name, err }, 'job failed');
  } finally {
    running.delete(name);
  }
}

export async function extendAllHorizons(): Promise<number> {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  for (const u of users) await ensureGenerated(u.id);
  return users.length;
}

export function startScheduler(): void {
  const minute = 60_000;
  const reminders = () =>
    runJob('reminders', async () => {
      const planned = await planReminders();
      const sent = await dispatchReminders();
      return { planned, sent };
    });
  const autopay = () => runJob('autopay', processAutopay);
  const horizon = () => runJob('horizon', extendAllHorizons);
  const prune = () => runJob('prune', async () => ({ notifications: await pruneNotifications(), sync: await pruneSyncData() }));

  timers.push(setInterval(reminders, minute));
  timers.push(setInterval(autopay, 5 * minute));
  timers.push(setInterval(horizon, 6 * 60 * minute));
  timers.push(setInterval(prune, 24 * 60 * minute));

  // Kick everything off shortly after boot.
  setTimeout(() => {
    void horizon();
    void autopay();
    void reminders();
  }, 5_000).unref();

  for (const t of timers) t.unref();
  logger.info('background scheduler started');
}

export function stopScheduler(): void {
  for (const t of timers.splice(0)) clearInterval(t);
}
