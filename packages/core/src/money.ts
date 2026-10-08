import type { PeriodSummary, StoredBillStatus } from './types.js';

/**
 * Money is handled as decimal strings ("120.50") at every boundary and summed
 * as integer cents, so totals never suffer floating-point drift.
 */

export const MONEY_RE = /^-?\d{1,10}(\.\d{1,2})?$/;

export function toCents(amount: string | number): number {
  const s = String(amount).trim();
  if (!MONEY_RE.test(s)) throw new Error(`Invalid amount "${s}"`);
  const negative = s.startsWith('-');
  const [whole = '0', frac = ''] = s.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function fromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${s}` : s;
}

export interface SummaryRow {
  status: StoredBillStatus;
  amount: string;
  amountPaid: string | null;
  amountIsEstimate?: boolean;
  /** Local due date YYYY-MM-DD */
  dueDate: string;
}

/**
 * The amount to show for a bill occurrence: what was paid once it is
 * completed (the actual figure), otherwise the amount due, which may be an
 * estimate.
 */
export function billDisplayAmount(o: { status: string; amount: string; amountPaid: string | null; amountIsEstimate?: boolean }) {
  if (o.status === 'COMPLETED') return { amount: o.amountPaid ?? o.amount, estimated: false };
  return { amount: o.amount, estimated: Boolean(o.amountIsEstimate) };
}

/**
 * Totals for a set of bill occurrences. Skipped occurrences are excluded from
 * money totals; completed ones count what was actually paid. Only bills are
 * ever summarised — events are informational.
 */
export function summarizeBills(rows: SummaryRow[], today: string): PeriodSummary {
  let total = 0;
  let paid = 0;
  let remaining = 0;
  let overdue = 0;
  let estimated = false;
  const counts = { total: rows.length, pending: 0, completed: 0, skipped: 0, overdue: 0 };
  for (const r of rows) {
    if (r.status === 'SKIPPED') {
      counts.skipped++;
      continue;
    }
    const amount = toCents(r.amount);
    if (r.status === 'COMPLETED') {
      counts.completed++;
      const actual = r.amountPaid != null ? toCents(r.amountPaid) : amount;
      paid += actual;
      total += actual;
    } else {
      total += amount;
      remaining += amount;
      if (r.amountIsEstimate) estimated = true;
      if (r.dueDate < today) {
        counts.overdue++;
        overdue += amount;
      } else {
        counts.pending++;
      }
    }
  }
  return { counts, total: fromCents(total), paid: fromCents(paid), remaining: fromCents(remaining), overdue: fromCents(overdue), estimated };
}
