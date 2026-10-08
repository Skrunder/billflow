import type { Database, SqlJsStatic } from 'sql.js';
import type { SqlDriver, SqlRow, SqlValue } from './driver';

/**
 * SqlDriver backed by sql.js (SQLite compiled to WebAssembly). Used for
 * browser development of the standalone app and for tests. The whole
 * database lives in memory; `persist` (optional) is called with a snapshot
 * after writes so the browser build can keep it in IndexedDB.
 */
export function createSqlJsDriver(
  SQL: SqlJsStatic,
  options: { data?: Uint8Array | null; persist?: (bytes: Uint8Array) => void; persistDelayMs?: number } = {},
): SqlDriver & { export(): Uint8Array } {
  const db: Database = new SQL.Database(options.data ?? undefined);
  db.run('PRAGMA foreign_keys = ON');
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    async run(sql: string, params: SqlValue[] = []) {
      db.run(sql, params);
    },
    async all<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async exec(sql: string) {
      db.exec(sql);
    },
    afterWrite() {
      if (!options.persist) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        options.persist!(db.export());
      }, options.persistDelayMs ?? 300);
    },
    export: () => db.export(),
    async close() {
      if (timer) {
        clearTimeout(timer);
        options.persist?.(db.export());
      }
      db.close();
    },
  };
}

// ── IndexedDB snapshot storage (browser development builds) ────────────────

const IDB_NAME = 'skr-bill-calendar-local';
const IDB_STORE = 'snapshots';
const IDB_KEY = 'main';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSnapshot(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
