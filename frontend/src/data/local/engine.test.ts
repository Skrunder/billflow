import { occurrenceId, type BillInput, type EventInput } from '@skr/core';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { createRemoteRepository } from '../remote';
import { createLocalRepository, type LocalRepository } from './engine';
import { createSqlJsDriver } from './sqljs-driver';
import { MIGRATIONS } from './schema';

/**
 * The local engine must give the same guarantees as the server
 * (backend/tests/integration/occurrences.test.ts) — most importantly that
 * every occurrence is independent — running on a real SQLite database.
 */

let SQL: SqlJsStatic;
let clock: Date;
let repo: LocalRepository;
let driver: ReturnType<typeof createSqlJsDriver>;

// Wed Oct 7 2026, 10:00 in Chicago.
const START = new Date('2026-10-07T15:00:00.000Z');

async function fresh(data?: Uint8Array) {
  driver = createSqlJsDriver(SQL, { data });
  repo = await createLocalRepository(driver, { clock: () => clock, timezone: 'America/Chicago', displayName: 'Pat' });
  return repo;
}

const bill = (over: Partial<BillInput> = {}): BillInput => ({
  name: 'Electric Bill',
  description: null,
  notes: null,
  amount: '120.50',
  categoryId: null,
  paymentMethod: 'MANUAL',
  scheduledPayDaysBefore: null,
  startDate: '2026-11-15',
  dueTime: null,
  recurrence: { frequency: 'MONTHLY', interval: 1, byWeekday: [], endDate: null, count: 3 },
  reminderOffsets: [1440],
  ...over,
});

const event = (over: Partial<EventInput> = {}): EventInput => ({
  title: 'Payday',
  description: null,
  notes: null,
  location: null,
  categoryId: null,
  startDate: '2026-11-06',
  startTime: null,
  endTime: null,
  recurrence: { frequency: 'WEEKLY', interval: 2, byWeekday: [], endDate: null, count: 3 },
  reminderOffsets: [],
  ...over,
});

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(async () => {
  clock = new Date(START);
  await fresh();
});

describe('first start', () => {
  it('creates a local profile, settings in the device timezone and default categories', async () => {
    const { user, settings } = await repo.getProfile();
    expect(user.displayName).toBe('Pat');
    expect(settings.timezone).toBe('America/Chicago');
    expect(settings.defaultBillReminders).toEqual([1440]);
    expect((await repo.listCategories('BILL')).map((c) => c.name)).toContain('Utilities');
    expect((await repo.listCategories('EVENT')).map((c) => c.name)).toContain('Payday Reminder');
  });

  it('implements every DataRepository method', () => {
    const local = Object.keys(repo).filter((k) => !['runMaintenance', 'getUpcomingReminders', 'createBackup', 'restoreBackup', 'close'].includes(k)).sort();
    expect(local).toEqual(Object.keys(createRemoteRepository()).sort());
    expect(repo.kind).toBe('local');
  });
});

describe('recurring bill occurrences are independent', () => {
  it('one row per due date, with deterministic ids', async () => {
    const b = await repo.createBill(bill());
    expect(b.recurrence?.rrule).toBe('FREQ=MONTHLY;COUNT=3');
    const occ = await repo.listBillOccurrences({ billId: b.id });
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(occ.map((o) => o.id)).toEqual(occ.map((o) => occurrenceId(b.id, o.originalDueDate)));
    expect(occ.every((o) => o.status === 'PENDING' && o.amount === '120.50')).toBe(true);
    // all-day bill: due instant = all-day reminder time (09:00) in Chicago (CST in November)
    expect(occ[0]!.dueAt).toBe('2026-11-15T15:00:00.000Z');
  });

  it('complete / skip / reopen / edit each touch exactly one occurrence, with its own history', async () => {
    const b = await repo.createBill(bill());
    const [jan, feb, mar] = await repo.listBillOccurrences({ billId: b.id });
    const statuses = async () => (await repo.listBillOccurrences({ billId: b.id })).map((o) => o.status);

    const done = await repo.completeBillOccurrence(jan!.id, { confirmationNumber: 'CONF-1' });
    expect(done).toMatchObject({ status: 'COMPLETED', amountPaid: '120.50', confirmationNumber: 'CONF-1' });
    expect(await statuses()).toEqual(['COMPLETED', 'PENDING', 'PENDING']);

    await repo.skipBillOccurrence(feb!.id);
    expect(await statuses()).toEqual(['COMPLETED', 'SKIPPED', 'PENDING']);

    expect((await repo.getHistory('bill-occurrences', jan!.id)).map((h) => h.action)).toEqual(['COMPLETED']);
    expect((await repo.getHistory('bill-occurrences', feb!.id)).map((h) => h.action)).toEqual(['SKIPPED']);
    expect(await repo.getHistory('bill-occurrences', mar!.id)).toEqual([]);

    // Template amount change: only the untouched pending occurrence follows.
    await repo.updateBill(b.id, bill({ amount: '99' }));
    let after = await repo.listBillOccurrences({ billId: b.id });
    expect(after.map((o) => o.amount)).toEqual(['120.50', '120.50', '99.00']);

    // Schedule change keeps ids and statuses of everything with history.
    await repo.updateBill(b.id, bill({ amount: '99', dueTime: '17:00' }));
    after = await repo.listBillOccurrences({ billId: b.id });
    expect(after.map((o) => o.id)).toEqual([jan!.id, feb!.id, mar!.id]);
    expect(await statuses()).toEqual(['COMPLETED', 'SKIPPED', 'PENDING']);
    expect(after[2]!.dueAt).toBe('2027-01-15T23:00:00.000Z');

    await repo.reopenBillOccurrence(jan!.id);
    expect(await statuses()).toEqual(['PENDING', 'SKIPPED', 'PENDING']);

    const edited = await repo.updateBillOccurrence(mar!.id, { amount: '150', notes: 'Winter heating' });
    expect(edited).toMatchObject({ isModified: true, amount: '150.00', notes: 'Winter heating' });
    expect((await repo.listBillOccurrences({ billId: b.id })).map((o) => o.amount)).toEqual(['120.50', '120.50', '150.00']);

    // An individually edited occurrence is never rewritten by template edits.
    await repo.updateBill(b.id, bill({ amount: '10', dueTime: '08:00' }));
    expect((await repo.getBillOccurrence(mar!.id)).amount).toBe('150.00');
  });

  it('rejects completing twice and future completion dates', async () => {
    const b = await repo.createBill(bill());
    const [o] = await repo.listBillOccurrences({ billId: b.id });
    await repo.completeBillOccurrence(o!.id);
    await expect(repo.completeBillOccurrence(o!.id)).rejects.toMatchObject({ status: 400 });
    const [, o2] = await repo.listBillOccurrences({ billId: b.id });
    await expect(repo.completeBillOccurrence(o2!.id, { completedAt: '2030-01-01T00:00:00Z' })).rejects.toMatchObject({ status: 400 });
  });

  it('ending a series keeps history and drops only untouched future occurrences', async () => {
    const b = await repo.createBill(bill({ recurrence: { frequency: 'MONTHLY', interval: 1, byWeekday: [], endDate: null, count: null } }));
    const [first] = await repo.listBillOccurrences({ billId: b.id });
    await repo.completeBillOccurrence(first!.id);
    await repo.setBillArchived(b.id, true);
    const left = await repo.listBillOccurrences({ billId: b.id });
    expect(left.map((o) => [o.id, o.status])).toEqual([[first!.id, 'COMPLETED']]);
    await repo.setBillArchived(b.id, false);
    expect((await repo.listBillOccurrences({ billId: b.id, end: '2027-03-31' })).length).toBe(5);
  });

  it('deleting a bill removes its occurrences but keeps the audit trail', async () => {
    const b = await repo.createBill(bill());
    await repo.deleteBill(b.id);
    await expect(repo.getBill(b.id)).rejects.toMatchObject({ status: 404 });
    expect(await repo.listBillOccurrences({ billId: b.id })).toEqual([]);
    expect((await repo.getHistory('bills', b.id)).map((h) => h.action)).toEqual(['DELETED', 'CREATED']);
  });
});

describe('recurring event occurrences are independent', () => {
  it('completing one payday leaves the others upcoming', async () => {
    const e = await repo.createEvent(event());
    const [a, b2] = await repo.listEventOccurrences({ eventId: e.id });
    await repo.completeEventOccurrence(a!.id);
    await repo.cancelEventOccurrence(b2!.id, { notes: 'holiday' });
    expect((await repo.listEventOccurrences({ eventId: e.id })).map((o) => o.status)).toEqual(['COMPLETED', 'CANCELLED', 'UPCOMING']);
    expect((await repo.getEventOccurrence(b2!.id)).notes).toBe('holiday');
    await repo.reopenEventOccurrence(a!.id);
    expect((await repo.listEventOccurrences({ eventId: e.id })).map((o) => o.status)).toEqual(['UPCOMING', 'CANCELLED', 'UPCOMING']);
  });

  it('timed events get correct start/end instants, including overnight', async () => {
    const e = await repo.createEvent(event({ startTime: '22:00', endTime: '02:00', recurrence: null, startDate: '2026-10-12' }));
    const [o] = await repo.listEventOccurrences({ eventId: e.id });
    expect(o).toMatchObject({ startAt: '2026-10-13T03:00:00.000Z', endAt: '2026-10-13T07:00:00.000Z', allDay: false });
  });
});

describe('statuses, dashboard and calendar', () => {
  it('derives OVERDUE and totals bills in exact cents, never counting events', async () => {
    await repo.createBill(bill({ name: 'Water', amount: '0.10', startDate: '2026-10-01', recurrence: null }));
    await repo.createBill(bill({ name: 'Gas', amount: '0.20', startDate: '2026-10-20', recurrence: null }));
    await repo.createEvent(event({ startDate: '2026-10-09', recurrence: null }));
    const overdue = await repo.listBillOccurrences({ status: 'OVERDUE' });
    expect(overdue.map((o) => o.name)).toEqual(['Water']);

    const d = await repo.getDashboard();
    expect(d.today).toBe('2026-10-07');
    expect(d.summary.month).toMatchObject({ total: '0.30', remaining: '0.30', overdue: '0.10' });
    expect(d.overdueBills.map((o) => o.status)).toEqual(['OVERDUE']);
    expect(d.upcomingEvents).toHaveLength(1);

    const cal = await repo.getCalendar('2026-10-01', '2026-10-31', 'all');
    expect(cal.items.map((i) => `${i.kind}:${i.title}:${i.status}`)).toEqual(['bill:Water:OVERDUE', 'bill:Gas:PENDING', 'event:Payday:UPCOMING']);
    expect((await repo.getCalendar('2026-10-01', '2026-10-31', 'events')).items.every((i) => i.amount === null)).toBe(true);
    await expect(repo.getCalendar('2026-01-01', '2027-12-31', 'all')).rejects.toMatchObject({ status: 400 });
  });

  it('extends recurring series on demand past the horizon', async () => {
    const b = await repo.createBill(bill({ recurrence: { frequency: 'YEARLY', interval: 1, byWeekday: [], endDate: null, count: null } }));
    const far = await repo.listBillOccurrences({ billId: b.id, end: '2029-12-31' });
    expect(far.map((o) => o.dueDate)).toEqual(['2026-11-15', '2027-11-15', '2028-11-15', '2029-11-15']);
  });
});

describe('background maintenance', () => {
  it('auto-pay completes only the due occurrence, as the system', async () => {
    const b = await repo.createBill(
      bill({ name: 'Streaming', startDate: '2026-10-06', paymentMethod: 'AUTOPAY', recurrence: { frequency: 'MONTHLY', interval: 1, byWeekday: [], endDate: null, count: 2 } }),
    );
    await repo.runMaintenance();
    const occ = await repo.listBillOccurrences({ billId: b.id });
    expect(occ.map((o) => o.status)).toEqual(['COMPLETED', 'PENDING']);
    expect((await repo.getHistory('bill-occurrences', occ[0]!.id))[0]).toMatchObject({ action: 'AUTOPAY_COMPLETED', actorType: 'SYSTEM' });
  });

  it('auto-pay respects the user setting, and reopened occurrences stay open', async () => {
    await repo.updateSettings({ autoCompleteAutopay: false });
    const b = await repo.createBill(bill({ startDate: '2026-10-06', paymentMethod: 'AUTOPAY', recurrence: null }));
    await repo.runMaintenance();
    const [o] = await repo.listBillOccurrences({ billId: b.id });
    expect(o!.status).toBe('OVERDUE');

    await repo.updateSettings({ autoCompleteAutopay: true });
    await repo.runMaintenance();
    expect((await repo.getBillOccurrence(o!.id)).status).toBe('COMPLETED');
    await repo.reopenBillOccurrence(o!.id);
    await repo.runMaintenance();
    expect((await repo.getBillOccurrence(o!.id)).status).toBe('OVERDUE');
  });

  it('delivers only the most recent due reminder to the inbox, once', async () => {
    await repo.createBill(bill({ name: 'Car Insurance', amount: '80', startDate: '2026-10-09', dueTime: '12:00', recurrence: null, reminderOffsets: [10080, 1440, 60] }));
    clock = new Date('2026-10-09T15:00:00.000Z'); // 2 hours before 12:00 Chicago (17:00Z)
    await repo.runMaintenance();
    await repo.runMaintenance();
    const inbox = await repo.listNotifications();
    expect(inbox.map((n) => n.title)).toEqual(['Car Insurance is due in 2 hours']);
    expect(inbox[0]!.body).toBe('$80.00 due Fri, Oct 9 at 12:00 PM');
    expect(await repo.getUnreadNotificationCount()).toBe(1);
    await repo.markAllNotificationsRead();
    expect(await repo.getUnreadNotificationCount()).toBe(0);
  });
});

describe('sync bookkeeping', () => {
  it('stamps statusChangedAt on status changes only, like the server', async () => {
    const b = await repo.createBill(bill());
    const [jan, feb] = await repo.listBillOccurrences({ billId: b.id });
    const row = async (id: string) => (await repo.createBackup()).tables.bill_occurrences!.find((r) => r.id === id)!;
    expect((await row(jan!.id)).status_changed_at).toBeNull();

    clock = new Date('2026-10-08T12:00:00.000Z');
    await repo.updateBillOccurrence(jan!.id, { notes: 'edited' });
    expect((await row(jan!.id)).status_changed_at).toBeNull();

    clock = new Date('2026-10-09T12:00:00.000Z');
    await repo.skipBillOccurrence(feb!.id);
    expect((await row(feb!.id)).status_changed_at).toBe('2026-10-09T12:00:00.000Z');
    clock = new Date('2026-10-10T12:00:00.000Z');
    await repo.reopenBillOccurrence(feb!.id);
    expect((await row(feb!.id)).status_changed_at).toBe('2026-10-10T12:00:00.000Z');
  });
});

describe('schema upgrades', () => {
  it('a phone database from 1.1 (schema 1) upgrades, deriving status times for finished occurrences', async () => {
    const d = createSqlJsDriver(SQL);
    await d.exec(MIGRATIONS[0]!);
    await d.run("INSERT INTO meta (key, value) VALUES ('schema_version', '1')");
    await d.run("INSERT INTO profile (id, display_name, created_at) VALUES ('p', 'Pat', '2026-09-01T00:00:00.000Z')");
    await d.run("INSERT INTO settings (id, timezone, updated_at) VALUES (1, 'America/Chicago', '2026-09-01T00:00:00.000Z')");
    await d.run(`INSERT INTO bills (id, name, amount, start_date, created_at, updated_at) VALUES ('b', 'Rent', '1500.00', '2026-09-01', 'x', 'x')`);
    await d.run(`INSERT INTO bill_occurrences (id, bill_id, original_due_date, due_date, due_at, amount, status, completed_at, created_at, updated_at)
                 VALUES ('o1', 'b', '2026-09-01', '2026-09-01', '2026-09-01T14:00:00.000Z', '1500.00', 'COMPLETED', '2026-09-01T15:00:00.000Z', 'x', 'x'),
                        ('o2', 'b', '2026-10-01', '2026-10-01', '2026-10-01T14:00:00.000Z', '1500.00', 'PENDING', NULL, 'x', 'x')`);
    repo = await createLocalRepository(d, { clock: () => clock });
    const rows = (await repo.createBackup()).tables.bill_occurrences!;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status_changed_at]))).toEqual({ o1: '2026-09-01T15:00:00.000Z', o2: null });
  });

  it('restoring a schema-1 backup derives status times too', async () => {
    const b = await repo.createBill(bill());
    const [first] = await repo.listBillOccurrences({ billId: b.id });
    await repo.completeBillOccurrence(first!.id, {});
    const backup = await repo.createBackup();
    const old = { ...backup, schemaVersion: 1, tables: { ...backup.tables, bill_occurrences: backup.tables.bill_occurrences!.map(({ status_changed_at: _s, ...r }) => r) } };
    await fresh();
    await repo.restoreBackup(JSON.parse(JSON.stringify(old)));
    const row = (await repo.createBackup()).tables.bill_occurrences!.find((r) => r.id === first!.id)!;
    expect(row.status_changed_at).toBe(row.completed_at);
  });
});

describe('backup and restore', () => {
  async function sample() {
    const b = await repo.createBill(bill());
    const [first] = await repo.listBillOccurrences({ billId: b.id });
    await repo.completeBillOccurrence(first!.id, { confirmationNumber: 'C-9' });
    await repo.createEvent(event());
    await repo.updateSettings({ currency: 'CAD', theme: 'DARK' });
    return { b, first: first! };
  }
  const snapshot = async () => {
    const { exportedAt: _e, ...rest } = (await repo.exportData()) as { exportedAt: string };
    return rest;
  };

  it('restores everything exactly, on another device, from the JSON file', async () => {
    const { first } = await sample();
    const before = await snapshot();
    const history = await repo.getHistory('bill-occurrences', first.id);
    const file = JSON.stringify(await repo.createBackup());

    await fresh(); // a different, brand-new device
    expect((await repo.listBills()).length).toBe(0);
    await repo.restoreBackup(JSON.parse(file));
    expect(await snapshot()).toEqual(before);
    expect(await repo.getHistory('bill-occurrences', first.id)).toEqual(history);
    expect((await repo.getProfile()).user.displayName).toBe('Pat');
  });

  it('rejects other files and newer backups, and a damaged backup changes nothing', async () => {
    await sample();
    const before = await snapshot();
    const backup = await repo.createBackup();
    await expect(repo.restoreBackup({ hello: 'world' })).rejects.toThrow('not a Bill Calendar backup');
    await expect(repo.restoreBackup({ ...backup, schemaVersion: 999 })).rejects.toThrow('newer version');
    const damaged = { ...backup, tables: { ...backup.tables, events: [{ id: 'x', title: { evil: true } }] } };
    await expect(repo.restoreBackup(damaged)).rejects.toThrow('damaged');
    expect(await snapshot()).toEqual(before);
  });
});

describe('phone reminders', () => {
  it('lists future reminders soonest first, with text for the moment they fire', async () => {
    const b = await repo.createBill(bill({ name: 'Car Insurance', amount: '80', startDate: '2026-10-09', dueTime: '12:00', recurrence: null, reminderOffsets: [10080, 1440, 60] }));
    await repo.createEvent(event({ title: 'Dentist', startDate: '2026-10-08', startTime: '09:00', endTime: '10:00', recurrence: null, reminderOffsets: [60] }));
    const [occ] = await repo.listBillOccurrences({ billId: b.id });

    const upcoming = await repo.getUpcomingReminders();
    // The 7-day reminder (Oct 2) is already past, so it is never scheduled.
    expect(upcoming.map((r) => [r.at, r.title])).toEqual([
      ['2026-10-08T13:00:00.000Z', 'Dentist in 1 hour'],
      ['2026-10-08T17:00:00.000Z', 'Car Insurance is due tomorrow'],
      ['2026-10-09T16:00:00.000Z', 'Car Insurance is due in 1 hour'],
    ]);
    expect(upcoming[1]).toMatchObject({ key: `${occ!.id}:1440`, body: '$80.00 due Fri, Oct 9 at 12:00 PM', url: `/bills/${b.id}?occurrence=${occ!.id}` });
    expect(await repo.getUpcomingReminders({ limit: 1 })).toHaveLength(1);

    // Paying the bill early cancels its reminders; nothing else changes.
    await repo.completeBillOccurrence(occ!.id, {});
    expect((await repo.getUpcomingReminders()).map((r) => r.title)).toEqual(['Dentist in 1 hour']);
  });

  it('reports committed changes only', async () => {
    let changes = 0;
    repo = await createLocalRepository(createSqlJsDriver(SQL), { clock: () => clock, timezone: 'America/Chicago', onChange: () => changes++ });
    await repo.getProfile();
    await repo.listBills();
    expect(changes).toBe(0);
    await repo.createBill(bill());
    expect(changes).toBe(1);
    await expect(repo.createBill(bill({ amount: '-5' }))).rejects.toBeInstanceOf(ApiError);
    expect(changes).toBe(1);
  });
});

describe('settings, categories and validation', () => {
  it('changing timezone moves due instants but never calendar dates', async () => {
    const b = await repo.createBill(bill({ recurrence: null }));
    const before = (await repo.listBillOccurrences({ billId: b.id }))[0]!;
    await repo.updateSettings({ timezone: 'Europe/London' });
    const after = (await repo.listBillOccurrences({ billId: b.id }))[0]!;
    expect(after.dueDate).toBe(before.dueDate);
    expect(after.dueAt).toBe('2026-11-15T09:00:00.000Z');
    expect((await repo.getProfile()).settings.timezone).toBe('Europe/London');
  });

  it('category rules: unique names, deleting keeps the bills', async () => {
    const pets = await repo.createCategory({ name: 'Pets', type: 'BILL', color: '#123456' });
    await expect(repo.createCategory({ name: 'Pets', type: 'BILL', color: '#123456' })).rejects.toMatchObject({ status: 409 });
    const b = await repo.createBill(bill({ categoryId: pets.id, recurrence: null }));
    expect((await repo.listCategories('BILL')).find((c) => c.id === pets.id)?.usageCount).toBe(1);
    await expect(repo.createBill(bill({ categoryId: (await repo.listCategories('EVENT'))[0]!.id }))).rejects.toMatchObject({ status: 400 });
    await repo.deleteCategory(pets.id);
    expect((await repo.getBill(b.id)).categoryId).toBeNull();
  });

  it('rejects invalid input exactly like the server', async () => {
    const err = await repo.createBill(bill({ name: '', amount: 'abc', startDate: '2026-02-30' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect((err as ApiError).details!.map((d) => d.path)).toEqual(expect.arrayContaining(['name', 'amount', 'startDate']));
    await expect(repo.updateSettings({ timezone: 'Mars/Base' })).rejects.toMatchObject({ status: 400 });
    await expect(repo.getBillOccurrence('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('a failed operation leaves no partial changes behind', async () => {
    await expect(repo.createBill(bill({ categoryId: 'missing-category' }))).rejects.toMatchObject({ status: 400 });
    expect(await repo.listBills()).toEqual([]);
    expect(await repo.listBillOccurrences({})).toEqual([]);
  });
});

describe('persistence', () => {
  it('survives a restart from the saved database file', async () => {
    const b = await repo.createBill(bill());
    const [o] = await repo.listBillOccurrences({ billId: b.id });
    await repo.completeBillOccurrence(o!.id);
    const bytes = driver.export();
    await repo.close();

    await fresh(bytes);
    expect((await repo.getProfile()).user.displayName).toBe('Pat');
    expect((await repo.getBillOccurrence(o!.id)).status).toBe('COMPLETED');
    expect((await repo.listCategories()).length).toBeGreaterThan(10); // defaults not duplicated
    expect((await repo.listCategories()).length).toBe((await repo.listCategories()).length);
  });

  it('exports everything in the same format as the server', async () => {
    await repo.createBill(bill());
    await repo.createEvent(event());
    const data = (await repo.exportData()) as Record<string, unknown[]> & { format: string };
    expect(data.format).toBe('skr-bill-calendar-export@1');
    expect(data.bills).toHaveLength(1);
    expect(data.billOccurrences).toHaveLength(3);
    expect(data.eventOccurrences).toHaveLength(3);
  });
});
