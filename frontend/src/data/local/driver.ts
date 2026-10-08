/**
 * Minimal async SQLite interface used by the local engine. Implementations:
 *   - sql.js (WebAssembly) for browser development and tests  → sqljs-driver.ts
 *   - native SQLite via Capacitor on Android (milestone 4)
 * Values: TEXT, INTEGER, REAL and NULL only.
 */
export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

export interface SqlDriver {
  /** Execute one statement that returns no rows. */
  run(sql: string, params?: SqlValue[]): Promise<void>;
  /** Execute one statement and return its rows as plain objects. */
  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Execute a script of several statements (schema migrations). */
  exec(sql: string): Promise<void>;
  /** Called after a successful write transaction (persistence hook). */
  afterWrite?(): void;
  close(): Promise<void>;
}
