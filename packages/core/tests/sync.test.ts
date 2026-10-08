import { describe, expect, it } from 'vitest';
import { BILL_STATUS_FIELDS, mergeOccurrence, mergeRecord, pushRequest, syncBillOccurrence, type SyncBillOccurrence } from '../src/index';

const occ = (over: Partial<SyncBillOccurrence> = {}): SyncBillOccurrence => ({
  id: '6f1c2b8e-0b6a-5c1e-9f3a-1d2e3f4a5b6c',
  billId: '0e0b7c55-41a3-4f2c-9a0e-2b8f6f1d3c4a',
  originalDueDate: '2026-11-15',
  dueDate: '2026-11-15',
  dueTime: null,
  dueAt: '2026-11-15T15:00:00.000Z',
  amount: '120.50',
  status: 'PENDING',
  completedAt: null,
  amountPaid: null,
  confirmationNumber: null,
  notes: null,
  scheduledPayDate: null,
  autopayAt: null,
  isModified: false,
  statusChangedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('sync merge rules', () => {
  it('last writer wins; a tie keeps the stored copy', () => {
    const a = { id: 'x', name: 'Rent', updatedAt: '2026-10-02T00:00:00.000Z' };
    const b = { id: 'x', name: 'Mortgage', updatedAt: '2026-10-03T00:00:00.000Z' };
    expect(mergeRecord(a, b)).toMatchObject({ winner: 'incoming', record: b, dropped: { name: { kept: 'Mortgage', discarded: 'Rent' } } });
    expect(mergeRecord(b, a)).toMatchObject({ winner: 'existing', record: b });
    expect(mergeRecord(a, { ...b, updatedAt: a.updatedAt })).toMatchObject({ winner: 'existing', record: a });
  });

  it('a field an older version does not send keeps its stored value', () => {
    const estimated = occ({ amountIsEstimate: true });
    const fromOldDevice = occ({ notes: 'paid by card', updatedAt: '2026-10-02T00:00:00.000Z' });
    delete fromOldDevice.amountIsEstimate;
    const { record, dropped } = mergeOccurrence(estimated, fromOldDevice, BILL_STATUS_FIELDS);
    expect(record).toMatchObject({ amountIsEstimate: true, notes: 'paid by card' });
    expect(dropped).toEqual({ notes: { kept: 'paid by card', discarded: null } });
    expect(mergeRecord({ id: 'b', amountIsEstimate: true, updatedAt: '2026-10-01' }, { id: 'b', updatedAt: '2026-10-02' }).record).toEqual({
      id: 'b',
      amountIsEstimate: true,
      updatedAt: '2026-10-02',
    });
    // An older peer's record (no field) still passes validation.
    expect(syncBillOccurrence.safeParse(fromOldDevice).success).toBe(true);
  });

  it('a later edit elsewhere never undoes a completion', () => {
    const paid = occ({
      status: 'COMPLETED',
      completedAt: '2026-10-05T12:00:00.000Z',
      amountPaid: '120.50',
      statusChangedAt: '2026-10-05T12:00:00.000Z',
      updatedAt: '2026-10-05T12:00:00.000Z',
    });
    // Another device edits the notes later, from a copy where the bill was still pending.
    const edited = occ({ notes: 'call them', isModified: true, updatedAt: '2026-10-06T09:00:00.000Z' });
    const { record, winner, dropped } = mergeOccurrence(paid, edited, BILL_STATUS_FIELDS);
    expect(winner).toBe('merged');
    expect(record).toMatchObject({ status: 'COMPLETED', amountPaid: '120.50', notes: 'call them', isModified: true, updatedAt: '2026-10-06T09:00:00.000Z' });
    // The older copy's status is not reported as lost: it never changed the status.
    expect(dropped).toEqual({ notes: { kept: 'call them', discarded: null } });
    // Same result whichever side receives it.
    expect(mergeOccurrence(edited, paid, BILL_STATUS_FIELDS).record).toEqual(record);
  });

  it('an explicit later reopen does override a completion', () => {
    const paid = occ({ status: 'COMPLETED', completedAt: '2026-10-05T12:00:00.000Z', amountPaid: '120.50', statusChangedAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z' });
    const reopened = occ({ statusChangedAt: '2026-10-06T08:00:00.000Z', updatedAt: '2026-10-06T08:00:00.000Z' });
    const { record, dropped } = mergeOccurrence(paid, reopened, BILL_STATUS_FIELDS);
    expect(record).toMatchObject({ status: 'PENDING', completedAt: null, amountPaid: null });
    expect(dropped.status).toEqual({ kept: 'PENDING', discarded: 'COMPLETED' });
  });

  it('validates pushed rows like the API and normalises instants', () => {
    const parsed = syncBillOccurrence.parse({ ...occ(), dueAt: '2026-11-15T09:00:00-06:00' });
    expect(parsed.dueAt).toBe('2026-11-15T15:00:00.000Z');
    expect(() => syncBillOccurrence.parse({ ...occ(), amount: '-5' })).toThrow();
    expect(() => syncBillOccurrence.parse({ ...occ(), status: 'OVERDUE' })).toThrow();
    const push = pushRequest.parse({ deviceId: occ().billId, batchId: occ().id });
    expect(push.changes.bills).toEqual([]);
    expect(push.deletes).toEqual([]);
  });
});
