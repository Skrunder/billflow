/**
 * End-to-end API tests against a real PostgreSQL database.
 * Run with:  TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/db npm test
 * (the schema is migrated by `prisma migrate deploy` beforehand — see README).
 */
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!enabled)('API integration', () => {
  let app: import('express').Express;
  let prisma: import('@prisma/client').PrismaClient;
  let tokenA = '';
  let tokenB = '';

  // A schedule fully in the future so nothing is overdue or back-filled.
  const nextMonth = DateTime.utc().plus({ months: 1 }).startOf('month');
  const jan = nextMonth.set({ day: 15 }).toISODate()!;
  const feb = nextMonth.plus({ months: 1 }).set({ day: 15 }).toISODate()!;
  const mar = nextMonth.plus({ months: 2 }).set({ day: 15 }).toISODate()!;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function register(email: string) {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse battery', displayName: email.split('@')[0], timezone: 'UTC' });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  async function billOccurrences(token: string, billId: string) {
    const res = await request(app).get(`/api/v1/bill-occurrences?billId=${billId}`).set(auth(token));
    expect(res.status).toBe(200);
    return res.body as { id: string; dueDate: string; status: string; amount: string }[];
  }

  beforeAll(async () => {
    ({ prisma } = await import('../../src/lib/prisma'));
    app = (await import('../../src/app')).createApp();
    await prisma.$executeRawUnsafe(
      'TRUNCATE users, user_settings, sessions, verification_tokens, categories, bills, bill_occurrences, events, event_occurrences, notifications, push_subscriptions, audit_logs CASCADE',
    );
    tokenA = await register('alice@example.com');
    tokenB = await register('bob@example.com');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ─────────────────────────────────────────────────────── bills ──

  describe('recurring bill occurrences are independent', () => {
    let billId = '';
    let occ: { id: string; dueDate: string; status: string; amount: string }[] = [];

    it('creates one occurrence row per due date', async () => {
      const res = await request(app)
        .post('/api/v1/bills')
        .set(auth(tokenA))
        .send({
          name: 'Electric Bill',
          amount: '120.50',
          startDate: jan,
          recurrence: { frequency: 'MONTHLY', interval: 1, count: 3 },
          reminderOffsets: [1440],
        });
      expect(res.status).toBe(201);
      expect(res.body.recurrence.rrule).toBe('FREQ=MONTHLY;COUNT=3');
      billId = res.body.id;

      occ = await billOccurrences(tokenA, billId);
      expect(occ.map((o) => o.dueDate)).toEqual([jan, feb, mar]);
      expect(occ.every((o) => o.status === 'PENDING')).toBe(true);
      expect(new Set(occ.map((o) => o.id)).size).toBe(3);
    });

    it('completing January leaves February and March pending', async () => {
      const res = await request(app)
        .post(`/api/v1/bill-occurrences/${occ[0]!.id}/complete`)
        .set(auth(tokenA))
        .send({ confirmationNumber: 'CONF-1' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.amountPaid).toBe('120.50');

      const after = await billOccurrences(tokenA, billId);
      expect(after.map((o) => o.status)).toEqual(['COMPLETED', 'PENDING', 'PENDING']);
    });

    it('skipping February does not affect January or March', async () => {
      await request(app).post(`/api/v1/bill-occurrences/${occ[1]!.id}/skip`).set(auth(tokenA)).send({}).expect(200);
      const after = await billOccurrences(tokenA, billId);
      expect(after.map((o) => o.status)).toEqual(['COMPLETED', 'SKIPPED', 'PENDING']);
    });

    it('each occurrence keeps its own audit history', async () => {
      const h0 = await request(app).get(`/api/v1/bill-occurrences/${occ[0]!.id}/history`).set(auth(tokenA)).expect(200);
      const h1 = await request(app).get(`/api/v1/bill-occurrences/${occ[1]!.id}/history`).set(auth(tokenA)).expect(200);
      const h2 = await request(app).get(`/api/v1/bill-occurrences/${occ[2]!.id}/history`).set(auth(tokenA)).expect(200);
      expect(h0.body.map((h: { action: string }) => h.action)).toEqual(['COMPLETED']);
      expect(h1.body.map((h: { action: string }) => h.action)).toEqual(['SKIPPED']);
      expect(h2.body).toEqual([]);
    });

    it('template amount change only touches untouched pending occurrences', async () => {
      const res = await request(app)
        .put(`/api/v1/bills/${billId}`)
        .set(auth(tokenA))
        .send({ name: 'Electric Bill', amount: '99.00', startDate: jan, recurrence: { frequency: 'MONTHLY', interval: 1, count: 3 } });
      expect(res.status).toBe(200);
      const after = await billOccurrences(tokenA, billId);
      expect(after.map((o) => o.amount)).toEqual(['120.50', '120.50', '99.00']);
      expect(after.map((o) => o.status)).toEqual(['COMPLETED', 'SKIPPED', 'PENDING']);
    });

    it('template schedule change preserves completed/skipped occurrences (same ids)', async () => {
      await request(app)
        .put(`/api/v1/bills/${billId}`)
        .set(auth(tokenA))
        .send({
          name: 'Electric Bill',
          amount: '99.00',
          startDate: jan,
          dueTime: '17:00',
          recurrence: { frequency: 'MONTHLY', interval: 1, count: 3 },
        })
        .expect(200);
      const after = await billOccurrences(tokenA, billId);
      expect(after[0]!.id).toBe(occ[0]!.id);
      expect(after[1]!.id).toBe(occ[1]!.id);
      expect(after.map((o) => o.status)).toEqual(['COMPLETED', 'SKIPPED', 'PENDING']);
    });

    it('reopening January does not change February', async () => {
      await request(app).post(`/api/v1/bill-occurrences/${occ[0]!.id}/reopen`).set(auth(tokenA)).expect(200);
      const after = await billOccurrences(tokenA, billId);
      expect(after.map((o) => o.status)).toEqual(['PENDING', 'SKIPPED', 'PENDING']);
    });

    it('editing one occurrence marks only that one as modified', async () => {
      const res = await request(app)
        .patch(`/api/v1/bill-occurrences/${occ[2]!.id}`)
        .set(auth(tokenA))
        .send({ amount: '150.00', notes: 'Winter heating' });
      expect(res.status).toBe(200);
      expect(res.body.isModified).toBe(true);
      const after = await billOccurrences(tokenA, billId);
      expect(after.map((o) => o.amount)).toEqual(['120.50', '120.50', '150.00']);
    });
  });

  // ────────────────────────────────────────────────────── events ──

  describe('estimated amounts', () => {
    let billId = '';
    type Occ = { id: string; dueDate: string; status: string; amount: string; amountIsEstimate: boolean; amountPaid: string | null };
    const occs = async () => (await billOccurrences(tokenA, billId)) as unknown as Occ[];
    const calendarBills = async () => {
      const res = await request(app).get(`/api/v1/calendar?start=${jan}&end=${mar}&type=bills`).set(auth(tokenA));
      expect(res.status).toBe(200);
      return res.body.items as { occurrenceId: string; amount: string; amountIsEstimate: boolean }[];
    };

    it('a bill can be created with an estimated amount; its occurrences are estimates too', async () => {
      const res = await request(app)
        .post('/api/v1/bills')
        .set(auth(tokenA))
        .send({ name: 'Gas', amount: '80', amountIsEstimate: true, startDate: jan, recurrence: { frequency: 'MONTHLY', count: 3 } });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ amount: '80.00', amountIsEstimate: true });
      billId = res.body.id;
      expect((await occs()).map((o) => o.amountIsEstimate)).toEqual([true, true, true]);
      expect((await calendarBills()).filter((i) => i.amountIsEstimate)).toHaveLength(3);
      // Without the field a bill is not an estimate (as before 1.4.0).
      const plain = await request(app).post('/api/v1/bills').set(auth(await register('dan@example.com'))).send({ name: 'Rent', amount: '900', startDate: jan });
      expect(plain.body.amountIsEstimate).toBe(false);
    });

    it('paying records the actual amount; the estimate stays in the record', async () => {
      const [j] = await occs();
      const res = await request(app).post(`/api/v1/bill-occurrences/${j!.id}/complete`).set(auth(tokenA)).send({ amountPaid: '92.15' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'COMPLETED', amount: '80.00', amountIsEstimate: true, amountPaid: '92.15' });
      // The calendar shows what was paid, no longer as an estimate.
      expect((await calendarBills()).find((i) => i.occurrenceId === j!.id)).toMatchObject({ amount: '92.15', amountIsEstimate: false });
    });

    it('one month can be set apart; the bill setting then reaches only untouched months', async () => {
      const [, f] = await occs();
      const edited = await request(app).patch(`/api/v1/bill-occurrences/${f!.id}`).set(auth(tokenA)).send({ amount: '85.00', amountIsEstimate: false });
      expect(edited.body).toMatchObject({ amount: '85.00', amountIsEstimate: false, isModified: true });

      const bill = (await request(app).get(`/api/v1/bills/${billId}`).set(auth(tokenA))).body;
      const put = await request(app)
        .put(`/api/v1/bills/${billId}`)
        .set(auth(tokenA))
        .send({ ...bill, amountIsEstimate: false, recurrence: { frequency: 'MONTHLY', count: 3 } });
      expect(put.status).toBe(200);
      expect((await occs()).map((o) => [o.status, o.amountIsEstimate])).toEqual([
        ['COMPLETED', true], // paid: never changed by template edits
        ['PENDING', false],
        ['PENDING', false],
      ]);
      await request(app).put(`/api/v1/bills/${billId}`).set(auth(tokenA)).send({ ...bill, amountIsEstimate: true, recurrence: { frequency: 'MONTHLY', count: 3 } });
      expect((await occs()).map((o) => o.amountIsEstimate)).toEqual([true, false, true]); // February was edited on its own
    });

    it('dashboard totals count what was paid and flag estimates still to pay', async () => {
      const token = await register('erin@example.com');
      const today = DateTime.utc().toISODate()!;
      const a = await request(app).post('/api/v1/bills').set(auth(token)).send({ name: 'Water', amount: '40', amountIsEstimate: true, startDate: today });
      await request(app).post('/api/v1/bills').set(auth(token)).send({ name: 'Phone', amount: '30', startDate: today });
      let dash = (await request(app).get('/api/v1/dashboard').set(auth(token))).body;
      expect(dash.summary.today).toMatchObject({ total: '70.00', remaining: '70.00', estimated: true });

      const [w] = (await billOccurrences(token, a.body.id)) as { id: string }[];
      await request(app).post(`/api/v1/bill-occurrences/${w!.id}/complete`).set(auth(token)).send({ amountPaid: '43.70' });
      dash = (await request(app).get('/api/v1/dashboard').set(auth(token))).body;
      expect(dash.summary.today).toMatchObject({ total: '73.70', paid: '43.70', remaining: '30.00', estimated: false });
    });
  });

  describe('recurring event occurrences are independent', () => {
    it('completing one payday leaves the others upcoming', async () => {
      const start = nextMonth.set({ day: 2 }).toISODate()!;
      const created = await request(app)
        .post('/api/v1/events')
        .set(auth(tokenA))
        .send({ title: 'Payday Reminder', startDate: start, recurrence: { frequency: 'WEEKLY', interval: 2, count: 3 } });
      expect(created.status).toBe(201);

      const list = await request(app).get(`/api/v1/event-occurrences?eventId=${created.body.id}`).set(auth(tokenA)).expect(200);
      expect(list.body).toHaveLength(3);
      const [first, second] = list.body as { id: string }[];

      await request(app).post(`/api/v1/event-occurrences/${first!.id}/complete`).set(auth(tokenA)).send({}).expect(200);
      await request(app).post(`/api/v1/event-occurrences/${second!.id}/cancel`).set(auth(tokenA)).send({}).expect(200);

      const after = await request(app).get(`/api/v1/event-occurrences?eventId=${created.body.id}`).set(auth(tokenA)).expect(200);
      expect(after.body.map((o: { status: string }) => o.status)).toEqual(['COMPLETED', 'CANCELLED', 'UPCOMING']);
    });

    it('events never contribute to bill totals', async () => {
      const res = await request(app).get('/api/v1/dashboard').set(auth(tokenA)).expect(200);
      for (const s of Object.values(res.body.summary) as { total: string }[]) {
        expect(Number.isNaN(Number(s.total))).toBe(false);
      }
      const cal = await request(app)
        .get(`/api/v1/calendar?start=${nextMonth.toISODate()}&end=${nextMonth.plus({ months: 3 }).toISODate()}&type=events`)
        .set(auth(tokenA))
        .expect(200);
      expect(cal.body.items.every((i: { kind: string; amount: unknown }) => i.kind === 'event' && i.amount === null)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────── isolation ──

  describe('per-user data isolation', () => {
    it("user B cannot read or modify user A's occurrences", async () => {
      const aBills = await request(app).get('/api/v1/bills').set(auth(tokenA)).expect(200);
      const occs = await billOccurrences(tokenA, aBills.body[0].id);
      const target = occs[2]!.id;

      await request(app).get(`/api/v1/bill-occurrences/${target}`).set(auth(tokenB)).expect(404);
      await request(app).post(`/api/v1/bill-occurrences/${target}/complete`).set(auth(tokenB)).send({}).expect(404);
      await request(app).get(`/api/v1/bills/${aBills.body[0].id}`).set(auth(tokenB)).expect(404);

      const bBills = await request(app).get('/api/v1/bills').set(auth(tokenB)).expect(200);
      expect(bBills.body).toEqual([]);
      const still = await request(app).get(`/api/v1/bill-occurrences/${target}`).set(auth(tokenA)).expect(200);
      expect(still.body.status).toBe('PENDING');
    });

    it('rejects requests without a token', async () => {
      await request(app).get('/api/v1/bills').expect(401);
    });
  });

  // ───────────────────────────────────────────── background jobs ──

  describe('auto-pay and reminders', () => {
    it('auto-pay completes only the due occurrence', async () => {
      const yesterday = DateTime.utc().minus({ days: 1 }).toISODate()!;
      const created = await request(app)
        .post('/api/v1/bills')
        .set(auth(tokenA))
        .send({ name: 'Streaming', amount: '15.99', startDate: yesterday, paymentMethod: 'AUTOPAY', recurrence: { frequency: 'MONTHLY', interval: 1, count: 2 } })
        .expect(201);
      const { processAutopay } = await import('../../src/services/autopay.service');
      await processAutopay();
      const occs = await billOccurrences(tokenA, created.body.id);
      expect(occs.map((o) => o.status)).toEqual(['COMPLETED', 'PENDING']);
      const history = await request(app).get(`/api/v1/bill-occurrences/${occs[0]!.id}/history`).set(auth(tokenA)).expect(200);
      expect(history.body[0]).toMatchObject({ action: 'AUTOPAY_COMPLETED', actorType: 'SYSTEM' });
    });

    it('plans only the most recent due reminder and delivers it in-app', async () => {
      const due = DateTime.utc().plus({ days: 2 }).toISODate()!;
      const created = await request(app)
        .post('/api/v1/bills')
        .set(auth(tokenB))
        .send({ name: 'Car Insurance', amount: '80', startDate: due, dueTime: '12:00', reminderOffsets: [10080, 1440, 60] })
        .expect(201);
      const [occ] = await billOccurrences(tokenB, created.body.id);
      const { planReminders, dispatchReminders } = await import('../../src/services/reminder.service');
      const now = new Date(new Date(`${due}T12:00:00Z`).getTime() - 120 * 60_000); // 2h before due

      await planReminders(now);
      await planReminders(now); // idempotent
      const rows = await prisma.notification.findMany({ where: { billOccurrenceId: occ!.id }, orderBy: { offsetMinutes: 'asc' } });
      expect(rows.map((r) => [r.offsetMinutes, r.status])).toEqual([
        [1440, 'PENDING'],
        [10080, 'CANCELLED'],
      ]);

      await dispatchReminders(now);
      const inbox = await request(app).get('/api/v1/notifications').set(auth(tokenB)).expect(200);
      expect(inbox.body).toHaveLength(1);
      expect(inbox.body[0].title).toBe('Car Insurance is due in 2 hours');
      const other = await request(app).get('/api/v1/notifications').set(auth(tokenA)).expect(200);
      expect(other.body.find((n: { title: string }) => n.title.startsWith('Car Insurance'))).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────── auth ──

  describe('authentication', () => {
    it('refresh requires the CSRF header and rotates the refresh token', async () => {
      const agent = request.agent(app);
      const login = await agent.post('/api/v1/auth/login').send({ email: 'alice@example.com', password: 'correct horse battery' });
      expect(login.status).toBe(200);
      const cookies = ([] as string[]).concat(login.headers['set-cookie'] ?? []);
      const csrf = cookies.find((c) => c.startsWith('skr_csrf='))!.split(';')[0]!.split('=')[1]!;
      const refreshCookie = cookies.find((c) => c.startsWith('skr_rt='))!;
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/SameSite=Strict/i);

      await agent.post('/api/v1/auth/refresh').expect(403);
      const refreshed = await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf);
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.accessToken).toBeTruthy();

      // Replaying the old (rotated) token long after is detected.
      const rt0 = refreshCookie.split(';')[0]!;
      await prisma.session.updateMany({ where: { tokenHash: sha256(rt0.split('=')[1]!) }, data: { revokedAt: new Date(Date.now() - 120_000) } });
      const replay = await refresh(rt0, csrf);
      expect(replay.status).toBe(401);
      expect((await refresh(cookieOf(refreshed), csrf)).status).toBe(401); // whole family revoked
    });

    const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
    const cookieOf = (res: request.Response) =>
      ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('skr_rt='))!.split(';')[0]!;
    const refresh = (rt: string, csrf: string) =>
      request(app).post('/api/v1/auth/refresh').set('Cookie', [rt, `skr_csrf=${csrf}`]).set('X-CSRF-Token', csrf);
    async function browserLogin() {
      const login = await request(app).post('/api/v1/auth/login').send({ email: 'alice@example.com', password: 'correct horse battery' });
      const cookies = ([] as string[]).concat(login.headers['set-cookie'] ?? []);
      return { rt: cookieOf(login), csrf: cookies.find((c) => c.startsWith('skr_csrf='))!.split(';')[0]!.split('=')[1]! };
    }

    it('keeps the browser signed in when a refresh response is lost', async () => {
      const { rt, csrf } = await browserLogin();
      const lost = await refresh(rt, csrf); // the page reloads before this response arrives
      expect(lost.status).toBe(200);
      const retry = await refresh(rt, csrf); // the cookie jar still holds the old token
      expect(retry.status).toBe(200);
      expect(retry.body.accessToken).toBeTruthy();
      // Using the token that reached the browser retires the one that got lost…
      const next = await refresh(cookieOf(retry), csrf);
      expect(next.status).toBe(200);
      const lostRow = await prisma.session.findUnique({ where: { tokenHash: sha256(cookieOf(lost).split('=')[1]!) } });
      expect(lostRow?.revokedAt).toBeTruthy();
      // …and the browser carries on.
      expect((await refresh(cookieOf(next), csrf)).status).toBe(200);
    });

    it('serves concurrent refreshes from two tabs', async () => {
      const { rt, csrf } = await browserLogin();
      const [a, b] = await Promise.all([refresh(rt, csrf), refresh(rt, csrf)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      // Responses land in any order; whichever cookie the browser kept works.
      expect((await refresh(cookieOf(a), csrf)).status).toBe(200);
      const { rt: rt2, csrf: csrf2 } = await browserLogin();
      const [c, d] = await Promise.all([refresh(rt2, csrf2), refresh(rt2, csrf2)]);
      expect([c.status, d.status]).toEqual([200, 200]);
      expect((await refresh(cookieOf(d), csrf2)).status).toBe(200);
    });

    it('does not revive a signed-out session', async () => {
      const { rt, csrf } = await browserLogin();
      const rotated = await refresh(rt, csrf);
      await request(app).post('/api/v1/auth/logout').set('Cookie', [cookieOf(rotated), `skr_csrf=${csrf}`]).set('X-CSRF-Token', csrf).expect(204);
      expect((await refresh(rt, csrf)).status).toBe(401);
      expect((await refresh(cookieOf(rotated), csrf)).status).toBe(401);
    });

    it('rejects wrong passwords with a generic message', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({ email: 'alice@example.com', password: 'nope-nope' });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('validates input', async () => {
      const res = await request(app).post('/api/v1/bills').set(auth(tokenA)).send({ name: '', amount: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
