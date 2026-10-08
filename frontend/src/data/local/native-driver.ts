import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SqlDriver, SqlRow, SqlValue } from './driver';

/**
 * SqlDriver backed by the phone's own SQLite (Android app), through
 * @capacitor-community/sqlite. Every write lands in the database file
 * immediately, so no snapshot step is needed.
 *
 * The engine manages transactions itself (BEGIN / COMMIT / ROLLBACK through
 * exec), so the plugin's own per-call transactions are always turned off and
 * those three statements map to the plugin's transaction methods.
 */
export function createNativeSqliteDriver(conn: SQLiteDBConnection, onClose?: () => Promise<void>): SqlDriver {
  return {
    async run(sql: string, params: SqlValue[] = []) {
      await conn.run(sql, params, false, 'no');
    },
    async all<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      const res = await conn.query(sql, params);
      return (res.values ?? []) as T[];
    },
    async exec(sql: string) {
      const verb = sql.trim().toUpperCase();
      if (verb === 'BEGIN') return void (await conn.beginTransaction());
      if (verb === 'COMMIT') return void (await conn.commitTransaction());
      if (verb === 'ROLLBACK') return void (await conn.rollbackTransaction());
      for (const statement of splitStatements(sql)) await conn.execute(statement, false);
    },
    async close() {
      await conn.close();
      await onClose?.();
    },
  };
}

/**
 * Splits a migration script into single statements: drops `--` comments and
 * splits on `;`. Migration scripts contain no string literals with `;` or
 * `--` and no triggers; keep it that way (see schema.ts).
 */
export function splitStatements(script: string): string[] {
  return script
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
