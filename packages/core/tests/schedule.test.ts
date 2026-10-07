import { describe, expect, it } from 'vitest';
import {
  BACKFILL_DAYS,
  billInstants,
  eventInstants,
  initialGenerationRange,
  planReconcile,
  regenerationRange,
  wantedSlots,
} from '../src/schedule.js';
import { addDays } from '../src/time.js';

const chicago = { timezone: 'America/Chicago', allDayReminderTime: '09:00' };

describe('billInstants', () => {
  it('uses the all-day reminder time and handles DST', () => {
    expect(billInstants('2026-10-15', null, { paymentMethod: 'MANUAL', scheduledPayDaysBefore: null }, chicago)).toEqual({
      dueAt: new Date('2026-10-15T14:00:00.000Z'),
      scheduledPayDate: null,
      autopayAt: null,
    });
    expect(billInstants('2026-11-15', null, { paymentMethod: 'MANUAL', scheduledPayDaysBefore: null }, chicago).dueAt).toEqual(
      new Date('2026-11-15T15:00:00.000Z'),
    );
  });

  it('computes auto-pay on the due date and scheduled auto-pay N days earlier', () => {
    expect(billInstants('2026-10-21', '17:00', { paymentMethod: 'AUTOPAY', scheduledPayDaysBefore: null }, chicago)).toEqual({
      dueAt: new Date('2026-10-21T22:00:00.000Z'),
      scheduledPayDate: '2026-10-21',
      autopayAt: new Date('2026-10-21T22:00:00.000Z'),
    });
    const s = billInstants('2026-10-21', null, { paymentMethod: 'SCHEDULED_AUTOPAY', scheduledPayDaysBefore: 3 }, chicago);
    expect(s.scheduledPayDate).toBe('2026-10-18');
    expect(s.autopayAt).toEqual(new Date('2026-10-18T14:00:00.000Z'));
  });
});

describe('eventInstants', () => {
  it('handles all-day, timed and overnight events', () => {
    expect(eventInstants('2026-10-12', null, null, chicago)).toEqual({ startAt: new Date('2026-10-12T14:00:00.000Z'), endAt: null });
    expect(eventInstants('2026-10-12', '10:00', '11:00', chicago)).toEqual({
      startAt: new Date('2026-10-12T15:00:00.000Z'),
      endAt: new Date('2026-10-12T16:00:00.000Z'),
    });
    expect(eventInstants('2026-10-12', '22:00', '02:00', chicago).endAt).toEqual(new Date('2026-10-13T07:00:00.000Z'));
  });
});

describe('generation ranges', () => {
  it('one-time items generate only their own date', () => {
    expect(initialGenerationRange('2020-01-01', false, '2026-10-07')).toEqual({ from: '2020-01-01', to: '2020-01-01' });
  });

  it('recurring items back-fill at most BACKFILL_DAYS and run to the horizon', () => {
    expect(initialGenerationRange('2020-01-01', true, '2026-10-07', 30)).toEqual({
      from: addDays('2026-10-07', -BACKFILL_DAYS),
      to: '2026-11-06',
    });
    expect(initialGenerationRange('2026-10-01', true, '2026-10-07', 30).from).toBe('2026-10-01');
  });

  it('regeneration never reaches into the past', () => {
    expect(regenerationRange('2020-01-01', '2026-10-07', 30)).toEqual({ from: '2026-10-07', to: '2026-11-06' });
    expect(wantedSlots('2026-01-15', { frequency: 'MONTHLY', interval: 1 }, false, '2026-10-07', 60)).toEqual([
      '2026-10-15',
      '2026-11-15',
    ]);
    expect(wantedSlots('2026-01-15', { frequency: 'MONTHLY', interval: 1 }, true, '2026-10-07', 60)).toEqual([]);
  });
});

describe('planReconcile', () => {
  it('keeps matching slots, drops stale ones and reports missing ones', () => {
    const replaceable = [
      { id: 'a', slot: '2026-10-15' },
      { id: 'b', slot: '2026-11-15' },
      { id: 'c', slot: '2026-12-15' },
    ];
    const plan = planReconcile(replaceable, (o) => o.slot, ['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(plan.keep.map((o) => o.id)).toEqual(['b', 'c']);
    expect(plan.stale.map((o) => o.id)).toEqual(['a']);
    expect(plan.missing).toEqual(['2027-01-15']);
  });
});
