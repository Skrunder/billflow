import type { BillStatus, StoredBillStatus } from './types.js';

/**
 * OVERDUE is never stored: an occurrence is overdue when it is still PENDING
 * and its local due date is before "today" in the user's timezone.
 */
export function effectiveBillStatus(status: StoredBillStatus, dueDate: string, today: string): BillStatus {
  return status === 'PENDING' && dueDate < today ? 'OVERDUE' : status;
}

/** Whether an occurrence still needs action (reminders, auto-pay, quick "mark paid"). */
export function isBillActionable(status: BillStatus | StoredBillStatus): boolean {
  return status === 'PENDING' || status === 'OVERDUE';
}
