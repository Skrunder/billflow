import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { createLocalRepository } from './engine';
import { createNativeSqliteDriver, splitStatements } from './native-driver';

/**
 * Runs the native driver against a stand-in for the plugin's connection
 * (backed by sql.js) to check statement splitting and transaction mapping.
 * The real plugin is exercised by the Android emulator tests (docs/ANDROID.md).
 */
async function fakeConnection() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const calls: string[] = [];
  let inTx = false;
  const conn = {
    async run(sql: string, values: unknown[], transaction: boolean) {
      expect(transaction).toBe(false);
      db.run(sql, values as never);
      return { changes: { changes: db.getRowsModified() } };
    },
    async query(sql: string, values: unknown[]) {
      const stmt = db.prepare(sql);
      stmt.bind(values as never);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return { values: rows };
    },
    async execute(sql: string, transaction: boolean) {
      expect(transaction).toBe(false);
      calls.push(sql);
      db.exec(sql);
      return { changes: { changes: 0 } };
    },
    async beginTransaction() {
      if (inTx) throw new Error('Already in transaction');
      inTx = true;
      db.exec('BEGIN');
      return {};
    },
    async commitTransaction() {
      inTx = false;
      db.exec('COMMIT');
      return {};
    },
    async rollbackTransaction() {
      inTx = false;
      db.exec('ROLLBACK');
      return {};
    },
    async close() {
      db.close();
    },
  };
  return { conn: conn as unknown as SQLiteDBConnection, calls };
}

describe('native SQLite driver', () => {
  it('splits scripts into single statements without comments', () => {
    expect(splitStatements('CREATE TABLE a (x TEXT);\n  -- note; with a semicolon\nCREATE INDEX i ON a (x);\n')).toEqual([
      'CREATE TABLE a (x TEXT)',
      'CREATE INDEX i ON a (x)',
    ]);
  });

  it('keeps trigger bodies whole', () => {
    expect(splitStatements('CREATE TABLE t (x);\nCREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO u VALUES (1); INSERT INTO u VALUES (2); END;\nDROP TABLE t;')).toEqual([
      'CREATE TABLE t (x)',
      'CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO u VALUES (1); INSERT INTO u VALUES (2); END',
      'DROP TABLE t',
    ]);
  });

  it('runs the engine: migrations, writes and rollback of failed calls', async () => {
    const { conn, calls } = await fakeConnection();
    const repo = await createLocalRepository(createNativeSqliteDriver(conn), { timezone: 'America/Chicago' });
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.filter((c) => !c.startsWith('CREATE TRIGGER')).every((c) => !c.includes(';') && !c.includes('--'))).toBe(true);
    expect(calls.filter((c) => c.startsWith('CREATE TRIGGER')).every((c) => c.endsWith('END'))).toBe(true);

    const b = await repo.createBill({
      name: 'Rent', description: null, notes: null, amount: '1500', categoryId: null, paymentMethod: 'MANUAL',
      scheduledPayDaysBefore: null, startDate: '2026-11-01', dueTime: null,
      recurrence: { frequency: 'MONTHLY', interval: 1, byWeekday: [], endDate: null, count: 2 }, reminderOffsets: [],
    });
    expect(await repo.listBillOccurrences({ billId: b.id })).toHaveLength(2);
    await expect(repo.updateBill(b.id, { amount: 'x' } as never)).rejects.toThrow();
    expect((await repo.getBill(b.id)).amount).toBe('1500.00');
    await repo.close();
  });
});
