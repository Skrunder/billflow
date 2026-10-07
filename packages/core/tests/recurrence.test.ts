import { describe, expect, it } from 'vitest';
import { expandDates, toRRule } from '../src/recurrence.js';

describe('expandDates', () => {
  it('returns the single date for one-time items', () => {
    expect(expandDates('2026-01-15', null, '2026-01-01', '2026-12-31')).toEqual(['2026-01-15']);
    expect(expandDates('2026-01-15', null, '2026-02-01', '2026-12-31')).toEqual([]);
  });

  it('expands monthly on the same day', () => {
    expect(expandDates('2026-01-15', { frequency: 'MONTHLY', interval: 1 }, '2026-01-01', '2026-03-31')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('clamps day 31 to month end and returns to 31 afterwards', () => {
    expect(expandDates('2026-01-31', { frequency: 'MONTHLY', interval: 1 }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('supports custom intervals (every 2 weeks payday)', () => {
    expect(expandDates('2026-10-02', { frequency: 'WEEKLY', interval: 2 }, '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-02',
      '2026-10-16',
      '2026-10-30',
      '2026-11-13',
      '2026-11-27',
    ]);
  });

  it('supports weekly on several weekdays (Mon + Thu)', () => {
    // 2026-10-05 is a Monday
    expect(
      expandDates('2026-10-05', { frequency: 'WEEKLY', interval: 1, byWeekday: [1, 4] }, '2026-10-01', '2026-10-18'),
    ).toEqual(['2026-10-05', '2026-10-08', '2026-10-12', '2026-10-15']);
  });

  it('does not emit weekdays earlier than the start date in the first week', () => {
    // Start Wednesday 2026-10-07, BYDAY Mon,Fri → first is Fri 10-09
    expect(
      expandDates('2026-10-07', { frequency: 'WEEKLY', interval: 1, byWeekday: [1, 5] }, '2026-10-01', '2026-10-13'),
    ).toEqual(['2026-10-09', '2026-10-12']);
  });

  it('handles yearly Feb 29 in non-leap years', () => {
    expect(expandDates('2028-02-29', { frequency: 'YEARLY', interval: 1 }, '2028-01-01', '2032-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('respects end date and count, counting from the first occurrence', () => {
    const spec = { frequency: 'DAILY' as const, interval: 1, count: 5 };
    expect(expandDates('2026-01-01', spec, '2026-01-03', '2026-12-31')).toEqual(['2026-01-03', '2026-01-04', '2026-01-05']);
    expect(
      expandDates('2026-01-01', { frequency: 'DAILY', interval: 3, endDate: '2026-01-10' }, '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10']);
  });
});

describe('toRRule', () => {
  it('produces RFC 5545 rules', () => {
    expect(toRRule({ frequency: 'WEEKLY', interval: 2, byWeekday: [1, 5], count: 10 })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=10',
    );
    expect(toRRule({ frequency: 'MONTHLY', interval: 1, endDate: '2027-01-15' })).toBe('FREQ=MONTHLY;UNTIL=20270115');
    expect(toRRule(null)).toBeNull();
  });
});
