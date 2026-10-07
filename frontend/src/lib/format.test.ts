import { describe, expect, it } from 'vitest';
import { describeOffset, describeRecurrence, formatClock, formatMoney, relativeDay } from './format';

describe('format helpers', () => {
  it('formats money with the currency', () => {
    expect(formatMoney('1234.5', 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(null)).toBe('—');
  });

  it('formats clock times', () => {
    expect(formatClock('00:05', '12h')).toBe('12:05 AM');
    expect(formatClock('13:30', '12h')).toBe('1:30 PM');
    expect(formatClock('13:30', '24h')).toBe('13:30');
  });

  it('describes recurrences', () => {
    expect(describeRecurrence(null)).toBe('One time');
    expect(describeRecurrence({ frequency: 'WEEKLY', interval: 2, byWeekday: [], endDate: null, count: null })).toBe('Every 2 weeks');
    expect(describeRecurrence({ frequency: 'WEEKLY', interval: 1, byWeekday: [5, 1], endDate: null, count: 4 })).toBe(
      'Weekly on Mon, Fri, 4 times',
    );
    expect(describeRecurrence({ frequency: 'MONTHLY', interval: 1, byWeekday: [], endDate: null, count: null }, '2026-01-15')).toBe(
      'Monthly on day 15',
    );
  });

  it('describes reminder offsets', () => {
    expect(describeOffset(0)).toBe('At time of event');
    expect(describeOffset(15)).toBe('15 minutes before');
    expect(describeOffset(60)).toBe('1 hour before');
    expect(describeOffset(4320)).toBe('3 days before');
    expect(describeOffset(10080)).toBe('1 week before');
  });

  it('describes relative days', () => {
    expect(relativeDay('2026-10-07', '2026-10-07')).toBe('Today');
    expect(relativeDay('2026-10-08', '2026-10-07')).toBe('Tomorrow');
    expect(relativeDay('2026-10-04', '2026-10-07')).toBe('3 days ago');
  });
});
