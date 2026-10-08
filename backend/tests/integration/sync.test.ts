/**
 * Sync between phones (Android app) and the server, against a real
 * PostgreSQL database: two simulated phones plus the web app editing the same
 * account, covering conflicts, deletes, offline catch-up and security.
 */
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  occurrenceId,
  randomUuid,
  type PullResponse,
  type PushResponse,
  type SyncBill,
  type SyncBillOccurrence,
  type SyncChanges,
} from '@skr/core';

const enabled = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!enabled)('sync', () => {
  let app: import('express').Express;
  let prisma: import('@prisma/client').PrismaClient;

  const PASSWORD = 'correct horse battery';
  const nextMonth = DateTime.utc().plus({ months: 1 }).startOf('month');
  const d15 = nextMonth.set({ day: 15 }).toISODate()!;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Phone {
    token: string;
    refreshToken: string;
    deviceId: string;
    cursor: string;
    /** Latest copy of every row this phone has pulled, by entity and id. */
    rows: Map<string, Record<string, unknown>>;
  }

  let web = '';
  let phoneA: Phone;
  let phoneB: Phone;
  let bob: Phone;

  async function register(email: string) {
    const res = await request(app).post('/api/v1/auth/register').send({ email, password: PASSWORD, displayName: 'Test', timezone: 'UTC' });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  async function nativeLogin(email: string, deviceName: string): Promise<Phone> {
    const res = await request(app).post('/api/v1/auth/native/login').send({ email, password: PASSWORD, deviceName });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    return { token: res.body.accessToken, refreshToken: res.body.refreshToken, deviceId: res.body.deviceId, cursor: '0', rows: new Map() };
  }

  /** Pulls until caught up; returns everything received in this round. */
  async function pull(phone: Phone, limit?: number) {
    const all: PullResponse[] = [];
    for (let i = 0; i < 50; i++) {
      const res = await request(app)
        .get(`/api/v1/sync/pull?since=${phone.cursor}${limit ? `&limit=${limit}` : ''}`)
        .set(auth(phone.token));
      expect(res.status).toBe(200);
      const body = res.body as PullResponse;
      all.push(body);
      for (const [entity, list] of Object.entries(body.changes)) {
        if (Array.isArray(list)) for (const r of list) phone.rows.set(`${entity}:${r.id}`, r);
      }
      for (const d of body.deletes) phone.rows.delete(`${d.entity}:${d.id}`);
      phone.cursor = body.cursor;
      if (!body.hasMore) break;
    }
    const pick = <K extends keyof SyncChanges>(k: K) => all.flatMap((p) => (k === 'settings' ? (p.changes.settings ? [p.changes.settings] : []) : (p.changes[k] as unknown[])));
    return {
      pages: all.length,
      changes: (k: keyof SyncChanges) => pick(k) as Record<string, unknown>[],
      deletes: all.flatMap((p) => p.deletes),
    };
  }

  async function push(phone: Phone, changes: Partial<Record<keyof SyncChanges, unknown>>, deletes: unknown[] = [], batchId = randomUuid()) {
    const res = await request(app).post('/api/v1/sync/push').set(auth(phone.token)).send({ deviceId: phone.deviceId, batchId, changes, deletes });
    return res;
  }

  const row = <T>(phone: Phone, entity: string, id: string) => phone.rows.get(`${entity}:${id}`) as T;
  const later = (iso: string, ms = 60_000) => new Date(new Date(iso).getTime() + ms).toISOString();

  async function webOccurrence(billId: string) {
    const res = await request(app).get(`/api/v1/bill-occurrences?billId=${billId}`).set(auth(web));
    return res.body as { id: string; status: string; notes: string | null; amountPaid: string | null }[];
  }

  beforeAll(async () => {
    ({ prisma } = await import('../../src/lib/prisma'));
    app = (await import('../../src/app')).createApp();
    await prisma.$executeRawUnsafe(
      'TRUNCATE users, user_settings, sessions, verification_tokens, categories, bills, bill_occurrences, events, event_occurrences, notifications, push_subscriptions, audit_logs, devices, sync_batches, sync_tombstones CASCADE',
    );
    web = await register('alice@example.com');
    await register('bob@example.com');
    phoneA = await nativeLogin('alice@example.com', 'Pixel A');
    phoneB = await nativeLogin('alice@example.com', 'Pixel B');
    bob = await nativeLogin('bob@example.com', 'Bob phone');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ───────────────────────────────────────────────── native auth ──

  describe('native sign-in', () => {
    it('lists the account\'s devices', async () => {
      const res = await request(app).get('/api/v1/sync/devices').set(auth(web));
      expect(res.body.map((d: { name: string }) => d.name)).toEqual(['Pixel A', 'Pixel B']);
    });

    it('rotates refresh tokens; a lost response can be retried; old tokens are then dead', async () => {
      const r1 = await request(app).post('/api/v1/auth/native/refresh').send({ refreshToken: phoneA.refreshToken });
      expect(r1.status).toBe(200);
      expect(r1.body.deviceId).toBe(phoneA.deviceId);
      // The phone never received r1 and retries with the old token: it gets a fresh one, r1's is retired.
      const r2 = await request(app).post('/api/v1/auth/native/refresh').send({ refreshToken: phoneA.refreshToken });
      expect(r2.status).toBe(200);
      const stale = await request(app).post('/api/v1/auth/native/refresh').send({ refreshToken: r1.body.refreshToken });
      expect(stale.status).toBe(401);
      phoneA.refreshToken = r2.body.refreshToken;
      phoneA.token = r2.body.accessToken;
      const r3 = await request(app).post('/api/v1/auth/native/refresh').send({ refreshToken: phoneA.refreshToken });
      expect(r3.status).toBe(200);
      phoneA.refreshToken = r3.body.refreshToken;
      phoneA.token = r3.body.accessToken;
    });
  });

  // ─────────────────────────────────────────── first pull & web edits ──

  describe('pull', () => {
    it('first pull: settings, categories; web edits arrive with deterministic occurrence ids', async () => {
      const first = await pull(phoneA);
      expect(first.changes('settings')[0]).toMatchObject({ timezone: 'UTC' });
      expect(first.changes('settings')[0]).not.toHaveProperty('pushNotifications');
      expect(first.changes('categories').map((c) => c.name)).toContain('Utilities');

      const bill = await request(app)
        .post('/api/v1/bills')
        .set(auth(web))
        .send({ name: 'Electric', amount: '120.50', startDate: d15, recurrence: { frequency: 'MONTHLY', interval: 1, count: 3 }, reminderOffsets: [1440] });
      expect(bill.status).toBe(201);
      const next = await pull(phoneA);
      expect(next.changes('bills').map((b) => b.name)).toEqual(['Electric']);
      const occ = next.changes('billOccurrences') as SyncBillOccurrence[];
      expect(occ).toHaveLength(3);
      expect(occ.map((o) => o.id)).toEqual(occ.map((o) => occurrenceId(bill.body.id, o.originalDueDate)));
      // Nothing new: an empty pull.
      const again = await pull(phoneA);
      expect(again.changes('bills')).toEqual([]);
      expect(again.changes('billOccurrences')).toEqual([]);
    });

    it('never skips a transaction that commits after a later one', async () => {
      await pull(phoneB);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
      // A slow writer starts first (lower transaction id) …
      const slow = prisma.$transaction(
        async (tx) => {
          await tx.category.create({ data: { userId: user.id, type: 'BILL', name: 'Slow', color: '#123456' } });
          await gate;
        },
        { timeout: 20_000 },
      );
      await new Promise((r) => setTimeout(r, 200));
      // … a fast one commits meanwhile, and the phone pulls.
      const fast = await request(app).post('/api/v1/categories').set(auth(web)).send({ name: 'Fast', type: 'BILL', color: '#654321' });
      expect(fast.status).toBe(201);
      expect(fast.body).not.toHaveProperty('syncXid');
      const mid = await pull(phoneB);
      expect(mid.changes('categories').map((c) => c.name)).toEqual(['Fast']);
      release();
      await slow;
      const after = await pull(phoneB);
      expect(after.changes('categories').map((c) => c.name)).toContain('Slow');
    });

    it('pages big changes at transaction boundaries without gaps', async () => {
      for (const title of ['Walk', 'Pills', 'Water']) {
        const res = await request(app)
          .post('/api/v1/events')
          .set(auth(web))
          .send({ title, startDate: nextMonth.toISODate(), recurrence: { frequency: 'DAILY', interval: 1, count: 150 }, reminderOffsets: [] });
        expect(res.status).toBe(201);
      }
      const paged = { ...phoneB, rows: new Map(phoneB.rows), cursor: phoneB.cursor };
      const result = await pull(paged, 100);
      expect(result.pages).toBeGreaterThan(1);
      expect(result.changes('eventOccurrences')).toHaveLength(450);
      expect(new Set(result.changes('eventOccurrences').map((o) => o.id)).size).toBe(450);
      await pull(phoneB);
    });
  });

  // ───────────────────────────────────────────────────── push ──

  describe('push', () => {
    let billId = '';

    it('a bill created on a phone reaches the web app and the other phone, keeping its timestamps', async () => {
      billId = randomUuid();
      const stamp = new Date(Date.now() - 3_600_000).toISOString();
      const bill: SyncBill = {
        id: billId,
        categoryId: null,
        name: 'Internet',
        description: null,
        notes: null,
        amount: '65.99',
        paymentMethod: 'MANUAL',
        scheduledPayDaysBefore: null,
        startDate: d15,
        dueTime: null,
        recurrenceFrequency: null,
        recurrenceInterval: 1,
        recurrenceByWeekday: [],
        recurrenceEndDate: null,
        recurrenceCount: null,
        reminderOffsets: [1440],
        generatedUntil: d15,
        isArchived: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      const occ: SyncBillOccurrence = {
        id: occurrenceId(billId, d15),
        billId,
        originalDueDate: d15,
        dueDate: d15,
        dueTime: null,
        dueAt: `${d15}T09:00:00.000Z`,
        amount: '65.99',
        status: 'PENDING',
        completedAt: null,
        amountPaid: null,
        confirmationNumber: null,
        notes: null,
        scheduledPayDate: null,
        autopayAt: null,
        isModified: false,
        statusChangedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      const audit = { id: randomUuid(), actorType: 'USER', entityType: 'BILL', entityId: billId, action: 'CREATED', changes: null, createdAt: stamp };
      const res = await push(phoneA, { bills: [bill], billOccurrences: [occ], auditLogs: [audit] });
      expect(res.status).toBe(200);
      expect(res.body as PushResponse).toMatchObject({ applied: 3, adopt: [], remove: [], conflicts: 0 });

      const onWeb = await request(app).get(`/api/v1/bills/${billId}`).set(auth(web));
      expect(onWeb.body).toMatchObject({ name: 'Internet', amount: '65.99', updatedAt: stamp });
      const history = await request(app).get(`/api/v1/bills/${billId}/history`).set(auth(web));
      expect(history.body.map((h: { action: string }) => h.action)).toContain('CREATED');

      const b = await pull(phoneB);
      expect(b.changes('bills').map((x) => x.id)).toContain(billId);
      await pull(phoneA);
    });

    it('re-sending the same batch returns the first answer and changes nothing', async () => {
      const occ = row<SyncBillOccurrence>(phoneA, 'billOccurrences', occurrenceId(billId, d15));
      const batchId = randomUuid();
      const edit = { ...occ, notes: 'once', isModified: true, updatedAt: later(occ.updatedAt), baseUpdatedAt: occ.updatedAt };
      const first = await push(phoneA, { billOccurrences: [edit] }, [], batchId);
      const second = await push(phoneA, { billOccurrences: [{ ...edit, notes: 'twice' }] }, [], batchId);
      expect(second.body).toEqual(first.body);
      expect((await webOccurrence(billId))[0]!.notes).toBe('once');
      await pull(phoneA);
      await pull(phoneB);
    });

    it('an edit from a phone that missed a web payment keeps the payment', async () => {
      const id = occurrenceId(billId, d15);
      const stale = row<SyncBillOccurrence>(phoneB, 'billOccurrences', id);
      await request(app).post(`/api/v1/bill-occurrences/${id}/complete`).set(auth(web)).send({ confirmationNumber: 'WEB-1' });

      // Phone B (offline) changes the amount on its stale, still-pending copy, later than the payment.
      const edit = { ...stale, amount: '70.00', isModified: true, updatedAt: later(new Date().toISOString(), 5_000), baseUpdatedAt: stale.updatedAt };
      const res = await push(phoneB, { billOccurrences: [edit] });
      const body = res.body as PushResponse;
      expect(body.adopt).toHaveLength(1);
      expect(body.adopt[0]!.record).toMatchObject({ status: 'COMPLETED', confirmationNumber: 'WEB-1', amount: '70.00' });

      const [onWeb] = await webOccurrence(billId);
      expect(onWeb).toMatchObject({ status: 'COMPLETED', amountPaid: '65.99' });
      const history = await request(app).get(`/api/v1/bill-occurrences/${id}/history`).set(auth(web));
      expect(history.body.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['COMPLETED', 'SYNC_CONFLICT']));
    });

    it('an explicit reopen on a phone, made after the payment, does reopen it', async () => {
      await pull(phoneA);
      const id = occurrenceId(billId, d15);
      const paid = row<SyncBillOccurrence>(phoneA, 'billOccurrences', id);
      expect(paid.status).toBe('COMPLETED');
      const at = later(new Date().toISOString(), 10_000);
      const reopen = { ...paid, status: 'PENDING', completedAt: null, amountPaid: null, confirmationNumber: null, autopayAt: null, statusChangedAt: at, updatedAt: at, baseUpdatedAt: paid.updatedAt };
      const res = await push(phoneA, { billOccurrences: [reopen] });
      expect(res.body).toMatchObject({ applied: 1, conflicts: 0 });
      expect((await webOccurrence(billId))[0]!.status).toBe('PENDING');
    });

    it('a template deleted on the web: its rows are deleted on phones and stay deleted', async () => {
      const del = await request(app).delete(`/api/v1/bills/${billId}`).set(auth(web));
      expect(del.status).toBe(204);
      const res = await pull(phoneB);
      expect(res.deletes).toEqual(expect.arrayContaining([{ entity: 'bills', id: billId }, { entity: 'billOccurrences', id: occurrenceId(billId, d15) }]));

      // Phone A, offline, still edits the bill: deleting wins.
      const stale = row<SyncBill>(phoneA, 'bills', billId);
      const push1 = await push(phoneA, { bills: [{ ...stale, name: 'Internet (new plan)', updatedAt: later(new Date().toISOString()) }] });
      expect((push1.body as PushResponse).remove).toEqual([{ entity: 'bills', id: billId }]);
      expect((await request(app).get(`/api/v1/bills/${billId}`).set(auth(web))).status).toBe(404);
    });

    it('a phone dropping an occurrence that was paid elsewhere afterwards keeps it', async () => {
      const bill = await request(app)
        .post('/api/v1/bills')
        .set(auth(web))
        .send({ name: 'Water', amount: '30', startDate: d15, recurrence: null, reminderOffsets: [] });
      await pull(phoneA);
      const id = occurrenceId(bill.body.id, d15);
      const droppedAt = new Date(Date.now() - 1000).toISOString();
      await request(app).post(`/api/v1/bill-occurrences/${id}/complete`).set(auth(web)).send({});
      const res = await push(phoneA, {}, [{ entity: 'billOccurrences', id, deletedAt: droppedAt }]);
      expect((res.body as PushResponse).adopt.map((a) => (a.record as { id: string }).id)).toEqual([id]);
      expect((await webOccurrence(bill.body.id))[0]!.status).toBe('COMPLETED');

      // An untouched occurrence is deleted as asked.
      await request(app).post(`/api/v1/bill-occurrences/${id}/reopen`).set(auth(web));
      const untouched = await prisma.billOccurrence.update({ where: { id }, data: { statusChangedAt: null } });
      expect(untouched.status).toBe('PENDING');
      await push(phoneA, {}, [{ entity: 'billOccurrences', id, deletedAt: new Date(Date.now() + 1000).toISOString() }]);
      expect(await webOccurrence(bill.body.id)).toEqual([]);
    });

    it('the same category made on a phone and the server becomes one, and references follow', async () => {
      const phoneCategoryId = randomUuid();
      const stamp = new Date().toISOString();
      const bill = { ...row<SyncBill>(phoneA, 'bills', [...phoneA.rows.keys()].find((k) => k.startsWith('bills:'))!.slice(6)) };
      const res = await push(phoneA, {
        categories: [{ id: phoneCategoryId, type: 'BILL', name: 'Utilities', color: '#0ea5e9', icon: null, sortOrder: 0, createdAt: stamp, updatedAt: stamp }],
        bills: [{ ...bill, categoryId: phoneCategoryId, updatedAt: later(stamp) }],
      });
      const body = res.body as PushResponse;
      const serverUtilities = await prisma.category.findFirstOrThrow({ where: { name: 'Utilities', user: { email: 'alice@example.com' } } });
      expect(body.remapped).toEqual([{ entity: 'categories', from: phoneCategoryId, to: serverUtilities.id }]);
      expect((await request(app).get(`/api/v1/bills/${bill.id}`).set(auth(web))).body.category.id).toBe(serverUtilities.id);
    });

    it('settings from a phone apply on the server (but never the notification switches)', async () => {
      const { changes } = await pull(phoneA);
      const current = (changes('settings')[0] ?? null) as Record<string, unknown> | null;
      const base = current ?? (await pull({ ...phoneA, cursor: '0', rows: new Map() })).changes('settings')[0]!;
      const res = await push(phoneA, { settings: { ...base, timezone: 'America/Chicago', currency: 'CAD', updatedAt: later(new Date().toISOString()) } });
      expect(res.status).toBe(200);
      const me = await request(app).get('/api/v1/users/me').set(auth(web));
      expect(me.body.settings).toMatchObject({ timezone: 'America/Chicago', currency: 'CAD', pushNotifications: false });
    });
  });

  describe('web API unaffected', () => {
    it('responses never include sync bookkeeping', async () => {
      const me = await request(app).get('/api/v1/users/me').set(auth(web));
      expect(me.status).toBe(200);
      expect(me.body.settings).not.toHaveProperty('syncXid');
      const cats = await request(app).get('/api/v1/categories').set(auth(web));
      expect(cats.status).toBe(200);
      expect(cats.body[0]).not.toHaveProperty('syncXid');
      const edited = await request(app).patch(`/api/v1/categories/${cats.body[0].id}`).set(auth(web)).send({ color: '#111111' });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ color: '#111111' });
      expect(edited.body).not.toHaveProperty('syncXid');
    });
  });

  // ──────────────────────────────────────────────────── security ──

  describe('isolation', () => {
    it('another account can neither read nor overwrite this one', async () => {
      const bobPull = await pull(bob);
      expect(bobPull.changes('bills')).toEqual([]);

      const aliceOcc = [...phoneA.rows.entries()].find(([k]) => k.startsWith('billOccurrences:'))![1] as SyncBillOccurrence;
      const aliceBill = [...phoneA.rows.entries()].find(([k]) => k.startsWith('bills:'))![1] as SyncBill;
      const before = await prisma.billOccurrence.findUnique({ where: { id: aliceOcc.id } });
      const res = await push(bob, {
        bills: [{ ...aliceBill, name: 'hacked', updatedAt: later(new Date().toISOString()) }],
        billOccurrences: [{ ...aliceOcc, notes: 'hacked', updatedAt: later(new Date().toISOString()) }],
      }, [{ entity: 'bills', id: aliceBill.id, deletedAt: new Date().toISOString() }]);
      expect(res.status).toBe(200);
      expect((await prisma.bill.findUnique({ where: { id: aliceBill.id } }))?.name).not.toBe('hacked');
      expect(await prisma.billOccurrence.findUnique({ where: { id: aliceOcc.id } })).toEqual(before);

      // Using Alice's device id with Bob's token is refused.
      const stolen = await request(app).post('/api/v1/sync/push').set(auth(bob.token)).send({ deviceId: phoneA.deviceId, batchId: randomUuid() });
      expect(stolen.status).toBe(403);
    });

    it('rejects malformed records', async () => {
      const res = await push(phoneA, { bills: [{ id: 'not-a-uuid', name: '' }] });
      expect(res.status).toBe(400);
    });

    it('signing a phone out stops its sync and its refresh token', async () => {
      const out = await request(app).post('/api/v1/auth/native/logout').send({ refreshToken: phoneB.refreshToken });
      expect(out.status).toBe(204);
      expect((await push(phoneB, {})).status).toBe(403);
      expect((await request(app).post('/api/v1/auth/native/refresh').send({ refreshToken: phoneB.refreshToken })).status).toBe(401);
      const devices = await request(app).get('/api/v1/sync/devices').set(auth(web));
      expect(devices.body.map((d: { name: string }) => d.name)).toEqual(['Pixel A']);
    });
  });
});
