import { describe, expect, it } from 'vitest';
import { billReminderText, eventReminderText, minutesUntil, relativeLead, selectDueReminders } from '../src/reminders.js';
import { billInput, password, reminderOffsets, settingsInput, utf8Length } from '../src/schemas.js';

const s = { timezone: 'America/Chicago', locale: 'en-US', currency: 'USD', timeFormat: '12h' as const };

describe('reminders', () => {
  const due = new Date('2026-10-09T22:00:00.000Z'); // Fri Oct 9, 5:00 PM Chicago

  it('delivers only the most recent of several due offsets', () => {
    const now = new Date(due.getTime() - 120 * 60_000);
    expect(selectDueReminders(due, [10080, 1440, 60], now)).toEqual({ due: [10080, 1440], deliver: 1440 });
    expect(selectDueReminders(due, [60], now)).toEqual({ due: [], deliver: null });
  });

  it('describes the real lead time, even when delivered late', () => {
    const now = new Date(due.getTime() - 120 * 60_000);
    expect(minutesUntil(due, now, 1440)).toBe(120);
    expect(relativeLead(120)).toBe('in 2 hours');
    expect(relativeLead(1440)).toBe('tomorrow');
    expect(relativeLead(0)).toBe('now');
  });

  it('renders bill and event reminder text in the user timezone', () => {
    const now = new Date(due.getTime() - 1440 * 60_000);
    expect(billReminderText({ name: 'Car Insurance', amount: '96.2', dueAt: due, allDay: false, paymentMethod: 'AUTOPAY' }, 1440, now, s)).toEqual({
      title: 'Car Insurance is due tomorrow',
      body: '$96.20 due Fri, Oct 9 at 5:00 PM (auto-pay)',
    });
    expect(
      billReminderText({ name: 'Electric', amount: '80', amountIsEstimate: true, dueAt: due, allDay: true, paymentMethod: 'MANUAL' }, 1440, now, s).body,
    ).toBe('About $80.00 due Fri, Oct 9');
    expect(eventReminderText({ title: 'Dentist', startAt: due, allDay: false, location: 'Main St' }, 0, due, s)).toEqual({
      title: 'Dentist',
      body: 'Fri, Oct 9 at 5:00 PM · Main St',
    });
  });
});

describe('schemas', () => {
  it('validates bills like the API always has', () => {
    const ok = billInput.parse({ name: ' Rent ', amount: 1450, startDate: '2026-10-01', recurrence: { frequency: 'MONTHLY' } });
    expect(ok).toMatchObject({ name: 'Rent', amount: '1450', paymentMethod: 'MANUAL', amountIsEstimate: false, recurrence: { interval: 1, byWeekday: [] } });
    expect(billInput.safeParse({ name: 'X', amount: '1', startDate: '2026-02-30' }).success).toBe(false);
    expect(billInput.safeParse({ name: 'X', amount: '-1', startDate: '2026-02-01' }).success).toBe(false);
    expect(
      billInput.safeParse({ name: 'X', amount: '1', startDate: '2026-02-01', paymentMethod: 'SCHEDULED_AUTOPAY' }).success,
    ).toBe(false);
  });

  it('normalises reminder offsets and checks settings', () => {
    expect(reminderOffsets.parse([60, 1440, 60, 0])).toEqual([1440, 60, 0]);
    expect(reminderOffsets.safeParse([50000]).success).toBe(false);
    expect(settingsInput.safeParse({ timezone: 'Mars/Base' }).success).toBe(false);
    expect(settingsInput.parse({ timezone: 'Europe/Paris', currency: 'EUR' })).toEqual({ timezone: 'Europe/Paris', currency: 'EUR' });
  });

  it('measures password length in UTF-8 bytes (bcrypt limit) without Buffer', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é€😀')).toBe(2 + 3 + 4);
    expect(password.safeParse('😀'.repeat(18)).success).toBe(true); // 72 bytes
    expect(password.safeParse('😀'.repeat(19)).success).toBe(false); // 76 bytes
  });
});
