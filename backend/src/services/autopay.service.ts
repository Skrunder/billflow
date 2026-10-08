import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { audit } from './audit.service';

/**
 * Auto-completes AUTOPAY / SCHEDULED_AUTOPAY occurrences once their payment
 * instant has passed — but only for users who enabled "auto-complete auto-pay".
 * Each occurrence is completed individually with a conditional update, so an
 * occurrence the user already completed/skipped is never touched.
 */
export async function processAutopay(now = new Date()): Promise<number> {
  const due = await prisma.billOccurrence.findMany({
    where: {
      status: 'PENDING',
      autopayAt: { lte: now },
      bill: { paymentMethod: { not: 'MANUAL' } },
      user: { isActive: true, settings: { autoCompleteAutopay: true } },
    },
    select: { id: true, userId: true, amount: true, autopayAt: true },
    take: 1000,
  });

  let completed = 0;
  for (const o of due) {
    const res = await prisma.$transaction(async (tx) => {
      const r = await tx.billOccurrence.updateMany({
        where: { id: o.id, status: 'PENDING' },
        data: { status: 'COMPLETED', completedAt: o.autopayAt ?? now, amountPaid: o.amount, statusChangedAt: now },
      });
      if (r.count) {
        await audit(tx, {
          userId: o.userId,
          actorType: 'SYSTEM',
          entityType: 'BILL_OCCURRENCE',
          entityId: o.id,
          action: 'AUTOPAY_COMPLETED',
          changes: { status: { from: 'PENDING', to: 'COMPLETED' } },
        });
      }
      return r.count;
    });
    completed += res;
  }
  if (completed) logger.info({ completed }, 'auto-pay occurrences completed');
  return completed;
}
