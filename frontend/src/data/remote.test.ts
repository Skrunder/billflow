import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataRepository } from './repository';
import { createRemoteRepository } from './remote';

/**
 * Contract test: every RemoteRepository method must issue exactly the HTTP
 * request the REST API expects. Guards the web app against regressions when
 * the data layer changes, and forces new methods to be covered here.
 */

interface Captured {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

let calls: Captured[] = [];
let responseBody: unknown = {};

beforeEach(() => {
  calls = [];
  responseBody = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://test.local');
      calls.push({
        method: init.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(responseBody), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const bill = {
  name: 'Rent',
  description: null,
  notes: null,
  amount: '1450.00',
  categoryId: null,
  paymentMethod: 'MANUAL' as const,
  scheduledPayDaysBefore: null,
  startDate: '2026-10-01',
  dueTime: null,
  recurrence: { frequency: 'MONTHLY' as const, interval: 1, byWeekday: [], endDate: null, count: null },
  reminderOffsets: [1440],
};
const event = {
  title: 'Payday',
  description: null,
  notes: null,
  location: null,
  categoryId: null,
  startDate: '2026-10-02',
  startTime: null,
  endTime: null,
  recurrence: null,
  reminderOffsets: [],
};

type Case = [method: keyof DataRepository, call: (r: DataRepository) => Promise<unknown>, expected: Partial<Captured>];

const cases: Case[] = [
  ['getProfile', (r) => r.getProfile(), { method: 'GET', path: '/api/v1/users/me' }],
  ['updateProfile', (r) => r.updateProfile({ displayName: 'Sam' }), { method: 'PATCH', path: '/api/v1/users/me', body: { displayName: 'Sam' } }],
  ['updateSettings', (r) => r.updateSettings({ theme: 'DARK' }), { method: 'PUT', path: '/api/v1/users/settings', body: { theme: 'DARK' } }],

  ['listCategories', (r) => r.listCategories('BILL'), { method: 'GET', path: '/api/v1/categories', query: { type: 'BILL' } }],
  ['createCategory', (r) => r.createCategory({ name: 'Pets', type: 'BILL', color: '#000000' }), { method: 'POST', path: '/api/v1/categories', body: { name: 'Pets', type: 'BILL', color: '#000000' } }],
  ['updateCategory', (r) => r.updateCategory('c1', { name: 'Pets', color: '#111111' }), { method: 'PATCH', path: '/api/v1/categories/c1', body: { name: 'Pets', color: '#111111' } }],
  ['deleteCategory', (r) => r.deleteCategory('c1'), { method: 'DELETE', path: '/api/v1/categories/c1' }],

  ['listBills', (r) => r.listBills({ search: 'rent', categoryId: '', archived: 'false' }), { method: 'GET', path: '/api/v1/bills', query: { search: 'rent', archived: 'false' } }],
  ['getBill', (r) => r.getBill('b1'), { method: 'GET', path: '/api/v1/bills/b1' }],
  ['createBill', (r) => r.createBill(bill), { method: 'POST', path: '/api/v1/bills', body: bill }],
  ['updateBill', (r) => r.updateBill('b1', bill), { method: 'PUT', path: '/api/v1/bills/b1', body: bill }],
  ['setBillArchived', (r) => r.setBillArchived('b1', true), { method: 'POST', path: '/api/v1/bills/b1/archive' }],
  ['deleteBill', (r) => r.deleteBill('b1'), { method: 'DELETE', path: '/api/v1/bills/b1' }],

  ['listBillOccurrences', (r) => r.listBillOccurrences({ status: 'OVERDUE', order: 'desc', limit: 5 }), { method: 'GET', path: '/api/v1/bill-occurrences', query: { status: 'OVERDUE', order: 'desc', limit: '5' } }],
  ['getBillOccurrence', (r) => r.getBillOccurrence('o1'), { method: 'GET', path: '/api/v1/bill-occurrences/o1' }],
  ['completeBillOccurrence', (r) => r.completeBillOccurrence('o1', { amountPaid: '10.00' }), { method: 'POST', path: '/api/v1/bill-occurrences/o1/complete', body: { amountPaid: '10.00' } }],
  ['skipBillOccurrence', (r) => r.skipBillOccurrence('o1'), { method: 'POST', path: '/api/v1/bill-occurrences/o1/skip', body: {} }],
  ['reopenBillOccurrence', (r) => r.reopenBillOccurrence('o1'), { method: 'POST', path: '/api/v1/bill-occurrences/o1/reopen', body: {} }],
  ['updateBillOccurrence', (r) => r.updateBillOccurrence('o1', { amount: '99.00' }), { method: 'PATCH', path: '/api/v1/bill-occurrences/o1', body: { amount: '99.00' } }],

  ['listEvents', (r) => r.listEvents(), { method: 'GET', path: '/api/v1/events', query: {} }],
  ['getEvent', (r) => r.getEvent('e1'), { method: 'GET', path: '/api/v1/events/e1' }],
  ['createEvent', (r) => r.createEvent(event), { method: 'POST', path: '/api/v1/events', body: event }],
  ['updateEvent', (r) => r.updateEvent('e1', event), { method: 'PUT', path: '/api/v1/events/e1', body: event }],
  ['setEventArchived', (r) => r.setEventArchived('e1', false), { method: 'POST', path: '/api/v1/events/e1/unarchive' }],
  ['deleteEvent', (r) => r.deleteEvent('e1'), { method: 'DELETE', path: '/api/v1/events/e1' }],

  ['listEventOccurrences', (r) => r.listEventOccurrences({ eventId: 'e1' }), { method: 'GET', path: '/api/v1/event-occurrences', query: { eventId: 'e1' } }],
  ['getEventOccurrence', (r) => r.getEventOccurrence('x1'), { method: 'GET', path: '/api/v1/event-occurrences/x1' }],
  ['completeEventOccurrence', (r) => r.completeEventOccurrence('x1'), { method: 'POST', path: '/api/v1/event-occurrences/x1/complete', body: {} }],
  ['cancelEventOccurrence', (r) => r.cancelEventOccurrence('x1', { notes: 'sick' }), { method: 'POST', path: '/api/v1/event-occurrences/x1/cancel', body: { notes: 'sick' } }],
  ['reopenEventOccurrence', (r) => r.reopenEventOccurrence('x1'), { method: 'POST', path: '/api/v1/event-occurrences/x1/reopen', body: {} }],
  ['updateEventOccurrence', (r) => r.updateEventOccurrence('x1', { startTime: '10:00' }), { method: 'PATCH', path: '/api/v1/event-occurrences/x1', body: { startTime: '10:00' } }],

  ['getCalendar', (r) => r.getCalendar('2026-10-01', '2026-10-31', 'bills'), { method: 'GET', path: '/api/v1/calendar', query: { start: '2026-10-01', end: '2026-10-31', type: 'bills' } }],
  ['getDashboard', (r) => r.getDashboard(), { method: 'GET', path: '/api/v1/dashboard' }],
  ['getHistory', (r) => r.getHistory('bill-occurrences', 'o1'), { method: 'GET', path: '/api/v1/bill-occurrences/o1/history' }],

  ['listNotifications', (r) => r.listNotifications({ limit: 100 }), { method: 'GET', path: '/api/v1/notifications', query: { limit: '100' } }],
  ['getUnreadNotificationCount', (r) => r.getUnreadNotificationCount(), { method: 'GET', path: '/api/v1/notifications/unread-count' }],
  ['markNotificationRead', (r) => r.markNotificationRead('n1'), { method: 'POST', path: '/api/v1/notifications/n1/read' }],
  ['markAllNotificationsRead', (r) => r.markAllNotificationsRead(), { method: 'POST', path: '/api/v1/notifications/read-all' }],

  ['exportData', (r) => r.exportData(), { method: 'GET', path: '/api/v1/users/me/export' }],
];

describe('RemoteRepository', () => {
  const repo = createRemoteRepository();

  it('covers every repository method in this contract test', () => {
    const methods = Object.keys(repo).filter((k) => k !== 'kind').sort();
    expect(cases.map((c) => c[0]).sort()).toEqual(methods);
    expect(repo.kind).toBe('remote');
  });

  it.each(cases)('%s sends the expected request', async (_name, call, expected) => {
    await call(repo);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject(expected);
  });

  it('unwraps wrapped responses', async () => {
    responseBody = { count: 7 };
    expect(await repo.getUnreadNotificationCount()).toBe(7);
    responseBody = { user: { id: 'u1', displayName: 'Sam' } };
    expect(await repo.updateProfile({ displayName: 'Sam' })).toEqual({ id: 'u1', displayName: 'Sam' });
  });
});
