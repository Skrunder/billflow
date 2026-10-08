/**
 * End to end: the phone's real engine (frontend/src/data/local, on sql.js)
 * and its sync client (frontend/src/sync/client.ts) against this server, with
 * the web app editing the same account.
 *
 * Imports frontend code, so it is excluded from the backend's tsc (the
 * frontend workspace typechecks those modules); vitest runs it normally.
 */
import { DateTime } from 'luxon';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalRepository, type LocalRepository } from '../../../frontend/src/data/local/engine';
import { createSqlJsDriver } from '../../../frontend/src/data/local/sqljs-driver';
import { createSyncClient, type HttpTransport, type SyncClient } from '../../../frontend/src/sync/client';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const SERVER = 'http://localhost';
const PASSWORD = 'correct horse battery';

describe.skipIf(!enabled)('phone ⇄ server sync (real engine)', () => {
  let app: import('express').Express;
  let prisma: import('@prisma/client').PrismaClient;
  let SQL: SqlJsStatic;
  let web = '';

  const nextMonth = DateTime.utc().plus({ months: 1 }).startOf('month');
  const d10 = nextMonth.set({ day: 10 }).toISODate()!;
  const auth = () => ({ Authorization: `Bearer ${web}` });

  const http: HttpTransport = async ({ method, url, token, body }) => {
    const path = url.slice(SERVER.length);
    let r = method === 'GET' ? request(app).get(path) : method === 'POST' ? request(app).post(path) : request(app).delete(path);
    if (token) r = r.set('Authorization', `Bearer ${token}`);
    const res = body === undefined ? await r : await r.send(body as object);
    return { status: res.status, data: res.body };
  };

  interface Phone {
    repo: LocalRepository;
    client: SyncClient;
    secret: { value: string | null };
  }

  async function phone(name: string): Promise<Phone> {
    const repo = await createLocalRepository(createSqlJsDriver(SQL), { timezone: 'UTC', displayName: name });
    const secret = { value: null as string | null };
    const client = createSyncClient({
      repo,
      http,
      deviceName: name,
      pushBatchSize: 100,
      secrets: { load: async () => secret.value, save: async (v) => void (secret.value = v), clear: async () => void (secret.value = null) },
    });
    await client.init();
    return { repo, client, secret };
  }

  const bill = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    description: null,
    notes: null,
    amount: '100.00',
    categoryId: null,
    paymentMethod: 'MANUAL' as const,
    scheduledPayDaysBefore: null,
    startDate: d10,
    dueTime: null,
    recurrence: { frequency: 'MONTHLY' as const, interval: 1, byWeekday: [], endDate: null, count: 3 },
    reminderOffsets: [],
    ...over,
  });

  const webBills = async () => (await request(app).get('/api/v1/bills').set(auth())).body as { id: string; name: string }[];
  const webOcc = async (billId: string) =>
    (await request(app).get(`/api/v1/bill-occurrences?billId=${billId}`).set(auth())).body as { id: string; status: string; notes: string | null; dueDate: string }[];
  const names = async (p: Phone) => (await p.repo.listBills({})).map((b) => b.name).sort();

  let A: Phone;
  let B: Phone;
  let rentId = '';
  let internetId = '';

  beforeAll(async () => {
    ({ prisma } = await import('../../src/lib/prisma'));
    app = (await import('../../src/app')).createApp();
    SQL = await initSqlJs();
    await prisma.$executeRawUnsafe(
      'TRUNCATE users, user_settings, sessions, verification_tokens, categories, bills, bill_occurrences, events, event_occurrences, notifications, push_subscriptions, audit_logs, devices, sync_batches, sync_tombstones CASCADE',
    );
    const reg = await request(app).post('/api/v1/auth/register').send({ email: 'sam@example.com', password: PASSWORD, displayName: 'Sam', timezone: 'UTC' });
    web = reg.body.accessToken;
    const internet = await request(app).post('/api/v1/bills').set(auth()).send(bill('Internet', { amount: '65.99' }));
    internetId = internet.body.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('connecting a phone that already has data: preview, then combine both', async () => {
    A = await phone('Phone A');
    const rent = await A.repo.createBill(bill('Rent', { amount: '1500.00' }));
    rentId = rent.id;
    const [first] = await A.repo.listBillOccurrences({ billId: rentId });
    await A.repo.completeBillOccurrence(first!.id, { confirmationNumber: 'PHONE-1' });

    const preview = await A.client.prepareConnect('localhost', 'sam@example.com', PASSWORD);
    expect(preview).toMatchObject({ serverUrl: SERVER, phone: { bills: 1, events: 0 }, server: { bills: 1, events: 0 }, sameBills: [] });
    await A.client.finishConnect('combine');
    expect(A.client.getStatus()).toMatchObject({ phase: 'idle', pending: 0, email: 'sam@example.com' });

    expect((await webBills()).map((b) => b.name).sort()).toEqual(['Internet', 'Rent']);
    expect((await webOcc(rentId)).map((o) => o.status)).toEqual(['COMPLETED', 'PENDING', 'PENDING']);
    const history = await request(app).get(`/api/v1/bill-occurrences/${first!.id}/history`).set(auth());
    expect(history.body.map((h: { action: string }) => h.action)).toContain('COMPLETED');
    expect(await names(A)).toEqual(['Internet', 'Rent']);

    // The default categories became one set, with the server's ids.
    const phoneCats = (await A.repo.listCategories('BILL')).map((c) => `${c.name}:${c.id}`).sort();
    const serverCats = (await request(app).get('/api/v1/categories?type=BILL').set(auth())).body.map((c: { name: string; id: string }) => `${c.name}:${c.id}`).sort();
    expect(phoneCats).toEqual(serverCats);
  });

  it('a second phone replaces its own data with the server\'s', async () => {
    B = await phone('Phone B');
    await B.repo.createBill(bill('Old phone stuff'));
    const preview = await B.client.prepareConnect('http://localhost/', 'sam@example.com', PASSWORD);
    expect(preview).toMatchObject({ phone: { bills: 1 }, server: { bills: 2 } });
    await B.client.finishConnect('replace');
    expect(await names(B)).toEqual(['Internet', 'Rent']);
    const [paid] = await B.repo.listBillOccurrences({ billId: rentId });
    expect(paid).toMatchObject({ status: 'COMPLETED', confirmationNumber: 'PHONE-1' });
  });

  it('offline edits on two phones and the web all survive', async () => {
    const internetOcc = (await webOcc(internetId))[0]!;
    // Phone A pays Internet; phone B (not synced since) adds a note to the same occurrence; the web renames Rent.
    await A.repo.completeBillOccurrence(internetOcc.id, { confirmationNumber: 'A-PAID' });
    await new Promise((r) => setTimeout(r, 20));
    await B.repo.updateBillOccurrence(internetOcc.id, { notes: 'autopay next time' });
    const renamed = await request(app).put(`/api/v1/bills/${rentId}`).set(auth()).send({ ...bill('Rent (house)', { amount: '1500.00' }), recurrence: { frequency: 'MONTHLY', interval: 1, count: 3 } });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);

    await A.client.syncNow();
    await B.client.syncNow();
    await A.client.syncNow();
    for (const p of [A, B]) {
      expect(p.client.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
      const occ = await p.repo.getBillOccurrence(internetOcc.id);
      expect(occ).toMatchObject({ status: 'COMPLETED', confirmationNumber: 'A-PAID', notes: 'autopay next time' });
      expect(await names(p)).toEqual(['Internet', 'Rent (house)']);
    }
    expect((await webOcc(internetId))[0]).toMatchObject({ status: 'COMPLETED', notes: 'autopay next time' });
  });

  it('deletes travel both ways', async () => {
    await request(app).delete(`/api/v1/bills/${internetId}`).set(auth());
    await A.client.syncNow();
    expect(await names(A)).toEqual(['Rent (house)']);

    const temp = await B.repo.createBill(bill('Temporary'));
    await B.client.syncNow();
    expect((await webBills()).map((b) => b.name)).toContain('Temporary');
    await B.repo.deleteBill(temp.id);
    await B.client.syncNow();
    await A.client.syncNow();
    expect((await webBills()).map((b) => b.name)).not.toContain('Temporary');
    expect(await names(A)).toEqual(['Rent (house)']);
  });

  it('big changes upload in batches', async () => {
    const e = await A.repo.createEvent({
      title: 'Walk the dog',
      description: null,
      notes: null,
      location: null,
      categoryId: null,
      startDate: nextMonth.toISODate()!,
      startTime: '07:00',
      endTime: '07:30',
      recurrence: { frequency: 'DAILY', interval: 1, byWeekday: [], endDate: null, count: 365 },
      reminderOffsets: [],
    });
    expect(A.client.getStatus().pending).toBe(0); // status updates on sync / localChanged
    await A.client.localChanged();
    expect(A.client.getStatus().pending).toBeGreaterThan(300); // several push batches of 100
    await A.client.syncNow();
    const count = await prisma.eventOccurrence.count({ where: { eventId: e.id } });
    expect(count).toBe((await A.repo.listEventOccurrences({ eventId: e.id })).length);
    expect(A.client.getStatus().pending).toBe(0);
  });

  it('signed out by the server: local edits wait, signing in again uploads them', async () => {
    const devices = (await request(app).get('/api/v1/sync/devices').set(auth())).body as { id: string; name: string }[];
    const b = devices.find((d) => d.name === 'Phone B')!;
    await request(app).delete(`/api/v1/sync/devices/${b.id}`).set(auth());

    await B.repo.createBill(bill('Made while signed out'));
    await B.client.syncNow();
    expect(B.client.getStatus()).toMatchObject({ phase: 'signed-out' });
    expect(B.client.getStatus().pending).toBeGreaterThan(0);
    expect(await names(B)).toContain('Made while signed out');

    await B.client.signInAgain(PASSWORD);
    expect(B.client.getStatus()).toMatchObject({ phase: 'idle', pending: 0 });
    expect((await webBills()).map((x) => x.name)).toContain('Made while signed out');
  });

  it('a server too old for phone sync is named as such, not as a wrong password', async () => {
    const C = await phone('Phone C');
    const oldServer: HttpTransport = async (req) =>
      req.url.endsWith('/api/health') ? { status: 200, data: { status: 'ok', version: '1.0.0' } } : http(req);
    const client = createSyncClient({ repo: C.repo, http: oldServer, secrets: { load: async () => null, save: async () => {}, clear: async () => {} } });
    await expect(client.prepareConnect('localhost', 'sam@example.com', PASSWORD)).rejects.toThrow('This server runs Bill Calendar 1.0.0; phone sync needs 1.2.0 or newer');
  });

  it('wrong password, unreachable or non-https public servers are explained', async () => {
    const C = await phone('Phone C');
    await expect(C.client.prepareConnect('localhost', 'sam@example.com', 'nope nope nope')).rejects.toThrow('Wrong email or password');
    await expect(C.client.prepareConnect('http://bills.example.com', 'sam@example.com', PASSWORD)).rejects.toThrow('https://');
    const offline = createSyncClient({ repo: C.repo, http: async () => Promise.reject(new Error('ECONNREFUSED')), secrets: { load: async () => null, save: async () => {}, clear: async () => {} } });
    await expect(offline.prepareConnect('192.168.1.250', 'sam@example.com', PASSWORD)).rejects.toThrow('Can’t reach the server');
  });

  it('disconnecting keeps the phone\'s data and signs it out on the server', async () => {
    await A.client.disconnect();
    expect(A.client.getStatus().phase).toBe('disconnected');
    expect(await names(A)).toEqual(['Rent (house)']);
    expect(A.secret.value).toBeNull();
    const devices = (await request(app).get('/api/v1/sync/devices').set(auth())).body as { name: string }[];
    expect(devices.map((d) => d.name)).not.toContain('Phone A');
  });
});
