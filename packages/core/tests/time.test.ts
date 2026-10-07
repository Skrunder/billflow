import { describe, expect, it } from 'vitest';
import { addDays, localToUtc, startOfWeek, todayInZone, toIsoDate, fromIsoDate } from '../src/time.js';

describe('time helpers', () => {
  it('converts local wall-clock time to UTC, honouring DST', () => {
    // New York is UTC-4 in summer (EDT) and UTC-5 in winter (EST)
    expect(localToUtc('2026-07-15', '09:00', 'America/New_York').toISOString()).toBe('2026-07-15T13:00:00.000Z');
    expect(localToUtc('2026-01-15', '09:00', 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('computes "today" in the user timezone', () => {
    const instant = new Date('2026-10-07T02:30:00Z');
    expect(todayInZone('UTC', instant)).toBe('2026-10-07');
    expect(todayInZone('America/Los_Angeles', instant)).toBe('2026-10-06');
    expect(todayInZone('Asia/Tokyo', instant)).toBe('2026-10-07');
  });

  it('round-trips DATE values', () => {
    expect(toIsoDate(fromIsoDate('2026-02-28'))).toBe('2026-02-28');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('finds the start of week for Sunday and Monday starts', () => {
    // 2026-10-07 is a Wednesday
    expect(startOfWeek('2026-10-07', 0)).toBe('2026-10-04');
    expect(startOfWeek('2026-10-07', 1)).toBe('2026-10-05');
    expect(startOfWeek('2026-10-04', 1)).toBe('2026-09-28');
  });
});
