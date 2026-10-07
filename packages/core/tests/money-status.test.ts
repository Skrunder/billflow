import { describe, expect, it } from 'vitest';
import { fromCents, summarizeBills, toCents } from '../src/money.js';
import { effectiveBillStatus, isBillActionable } from '../src/status.js';

describe('money', () => {
  it('converts between decimal strings and cents exactly', () => {
    expect(toCents('120.5')).toBe(12050);
    expect(toCents('0.07')).toBe(7);
    expect(toCents(15)).toBe(1500);
    expect(fromCents(12050)).toBe('120.50');
    expect(fromCents(7)).toBe('0.07');
    expect(() => toCents('12.345')).toThrow();
  });

  it('summarises bills without floating-point drift and ignores skipped ones', () => {
    const s = summarizeBills(
      [
        { status: 'COMPLETED', amount: '0.10', amountPaid: null, dueDate: '2026-10-01' },
        { status: 'COMPLETED', amount: '50.00', amountPaid: '45.00', dueDate: '2026-10-02' },
        { status: 'PENDING', amount: '0.20', amountPaid: null, dueDate: '2026-10-03' },
        { status: 'PENDING', amount: '10.00', amountPaid: null, dueDate: '2026-10-20' },
        { status: 'SKIPPED', amount: '999.00', amountPaid: null, dueDate: '2026-10-04' },
      ],
      '2026-10-07',
    );
    expect(s).toEqual({
      counts: { total: 5, pending: 1, completed: 2, skipped: 1, overdue: 1 },
      total: '60.30',
      paid: '45.10',
      remaining: '10.20',
      overdue: '0.20',
    });
  });
});

describe('status', () => {
  it('derives OVERDUE only for pending occurrences past their local due date', () => {
    expect(effectiveBillStatus('PENDING', '2026-10-06', '2026-10-07')).toBe('OVERDUE');
    expect(effectiveBillStatus('PENDING', '2026-10-07', '2026-10-07')).toBe('PENDING');
    expect(effectiveBillStatus('COMPLETED', '2026-01-01', '2026-10-07')).toBe('COMPLETED');
    expect(effectiveBillStatus('SKIPPED', '2026-01-01', '2026-10-07')).toBe('SKIPPED');
    expect(isBillActionable('OVERDUE')).toBe(true);
    expect(isBillActionable('SKIPPED')).toBe(false);
  });
});
