import {
  BILL_STATUS_FIELDS,
  EVENT_STATUS_FIELDS,
  fillMissing,
  mergeOccurrence,
  mergeRecord,
  syncAuditLog,
  syncBill,
  syncBillOccurrence,
  syncCategory,
  syncEvent,
  syncEventOccurrence,
  syncSettings,
  type PullResponse,
  type PushResponse,
  type SyncChanges,
  type SyncDelete,
  type SyncEntity,
  type SyncSettings,
} from '@skr/core';
import type { SqlDriver, SqlRow, SqlValue } from './driver';
import { fromRow, toSnake, toSqlValue } from './models';

/**
 * The phone's side of server sync: reading local changes for upload and
 * applying what the server sends, on the on-device database.
 *
 * Local changes are recorded in `outbox` by triggers (schema step 3). While
 * server data is being written, `applying` is set in sync_state so those
 * writes aren't recorded as local changes. `sync_base` keeps the server's
 * updatedAt of each row (sent back as baseUpdatedAt, for conflict reporting).
 *
 * Every function runs inside the engine's per-call transaction.
 */

export const SYNC_TABLE: Record<SyncEntity, string> = {
  categories: 'categories',
  bills: 'bills',
  events: 'events',
  billOccurrences: 'bill_occurrences',
  eventOccurrences: 'event_occurrences',
  auditLogs: 'audit_logs',
};

/** Parents before children: the server must know a bill before its occurrences. */
const PUSH_ORDER: (SyncEntity | 'settings')[] = ['settings', 'categories', 'bills', 'events', 'billOccurrences', 'eventOccurrences', 'auditLogs'];
const keysOf = (shape: Record<string, unknown>) => Object.keys(shape).filter((k) => k !== 'baseUpdatedAt');
const RECORD_KEYS: Record<SyncEntity, string[]> = {
  categories: keysOf(syncCategory.shape),
  bills: keysOf(syncBill.shape),
  events: keysOf(syncEvent.shape),
  billOccurrences: keysOf(syncBillOccurrence.shape),
  eventOccurrences: keysOf(syncEventOccurrence.shape),
  auditLogs: keysOf(syncAuditLog.shape),
};
const SETTINGS_KEYS = keysOf(syncSettings.shape);
const AUDIT_TYPE: Partial<Record<SyncEntity, string>> = {
  categories: 'CATEGORY',
  bills: 'BILL',
  events: 'EVENT',
  billOccurrences: 'BILL_OCCURRENCE',
  eventOccurrences: 'EVENT_OCCURRENCE',
};

type AnyRecord = Record<string, unknown> & { id: string; updatedAt?: string };

export interface SyncState {
  serverUrl?: string;
  email?: string;
  deviceId?: string;
  cursor?: string;
  lastSyncAt?: string;
}

export interface PushBatch {
  changes: Partial<SyncChanges>;
  deletes: (SyncDelete & { deletedAt: string })[];
  /** What was collected, to acknowledge after the server answered. */
  keys: [string, string][];
  upTo: number;
  size: number;
}

export function createSyncStore(db: SqlDriver, run: (sql: string, params?: SqlValue[]) => Promise<void>) {
  const one = async (sql: string, params: SqlValue[] = []) => (await db.all(sql, params))[0] ?? null;

  async function applying(on: boolean) {
    if (on) await db.run("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('applying', '1')");
    else await db.run("DELETE FROM sync_state WHERE key = 'applying'");
  }

  // ── records ──

  function toRecord(entity: SyncEntity, row: SqlRow): AnyRecord {
    const model = fromRow<Record<string, unknown>>(row);
    const out: Record<string, unknown> = {};
    for (const k of RECORD_KEYS[entity]) out[k] = model[k] ?? null;
    if (entity === 'auditLogs') out.changes = model.changes == null ? null : JSON.parse(String(model.changes));
    return out as AnyRecord;
  }

  async function loadRecord(entity: SyncEntity, id: string) {
    const row = await one(`SELECT * FROM ${SYNC_TABLE[entity]} WHERE id = ?`, [id]);
    return row ? toRecord(entity, row) : null;
  }

  async function loadSettings(): Promise<SyncSettings> {
    const model = fromRow<Record<string, unknown>>((await one('SELECT * FROM settings WHERE id = 1'))!);
    return Object.fromEntries(SETTINGS_KEYS.map((k) => [k, model[k]])) as SyncSettings;
  }

  async function writeRecord(entity: SyncEntity, record: AnyRecord) {
    // A field missing from the record (sent by a server older than the app) keeps the column's value.
    const keys = RECORD_KEYS[entity].filter((k) => record[k] !== undefined);
    const table = SYNC_TABLE[entity];
    const values = keys.map((k) => (entity === 'auditLogs' && k === 'changes' ? (record.changes == null ? null : JSON.stringify(record.changes)) : toSqlValue(k, record[k])));
    const cols = keys.map(toSnake);
    const conflict = entity === 'auditLogs' ? 'DO NOTHING' : `DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`;
    await run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(id) ${conflict}`, values);
  }

  async function writeSettings(record: SyncSettings) {
    await run(`UPDATE settings SET ${SETTINGS_KEYS.map((k) => `${toSnake(k)} = ?`).join(', ')} WHERE id = 1`, SETTINGS_KEYS.map((k) => toSqlValue(k, (record as Record<string, unknown>)[k])));
  }

  const setBase = (entity: string, id: string, updatedAt: string) =>
    run('INSERT INTO sync_base (entity, id, updated_at) VALUES (?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET updated_at = excluded.updated_at', [entity, id, updatedAt]);
  const getBase = async (entity: string, id: string) => (await one('SELECT updated_at FROM sync_base WHERE entity = ? AND id = ?', [entity, id]))?.updated_at as string | undefined;
  const hasPending = async (entity: string, id: string, afterSeq = 0) =>
    Boolean(await one('SELECT 1 FROM outbox WHERE entity_type = ? AND entity_id = ? AND seq > ? LIMIT 1', [entity, id, afterSeq]));
  const dropPending = (entity: string, id: string) => run('DELETE FROM outbox WHERE entity_type = ? AND entity_id = ?', [entity, id]);

  /** Moves a row to the server's id, with everything that points at it. If the server's row is already here, they become one. */
  async function renameLocal(entity: SyncEntity, from: string, to: string) {
    if (from === to) return;
    await db.run('PRAGMA defer_foreign_keys = ON');
    const table = SYNC_TABLE[entity];
    const exists = Boolean(await one(`SELECT 1 FROM ${table} WHERE id = ?`, [to]));
    if (entity === 'categories') {
      await run('UPDATE bills SET category_id = ? WHERE category_id = ?', [to, from]);
      await run('UPDATE events SET category_id = ? WHERE category_id = ?', [to, from]);
    } else if (entity === 'billOccurrences') {
      await run('UPDATE OR IGNORE notifications SET bill_occurrence_id = ? WHERE bill_occurrence_id = ?', [to, from]);
    } else if (entity === 'eventOccurrences') {
      await run('UPDATE OR IGNORE notifications SET event_occurrence_id = ? WHERE event_occurrence_id = ?', [to, from]);
    }
    if (AUDIT_TYPE[entity]) await run('UPDATE audit_logs SET entity_id = ? WHERE entity_type = ? AND entity_id = ?', [to, AUDIT_TYPE[entity]!, from]);
    await run('UPDATE OR IGNORE sync_base SET id = ? WHERE entity = ? AND id = ?', [to, entity, from]);
    await run('UPDATE outbox SET entity_id = ? WHERE entity_type = ? AND entity_id = ?', [to, entity, from]);
    if (exists) await run(`DELETE FROM ${table} WHERE id = ?`, [from]);
    else await run(`UPDATE ${table} SET id = ? WHERE id = ?`, [to, from]);
  }

  async function deleteLocal(entity: SyncEntity, id: string) {
    await run(`DELETE FROM ${SYNC_TABLE[entity]} WHERE id = ?`, [id]);
    await run('DELETE FROM sync_base WHERE entity = ? AND id = ?', [entity, id]);
    await dropPending(entity, id);
  }

  /**
   * Writes a server record. A local change not yet uploaded is merged with the
   * same rules the server uses, and stays queued.
   */
  async function applyIncoming(entity: SyncEntity, record: AnyRecord, pendingAfter = 0) {
    const { baseUpdatedAt: _b, ...incoming } = record as AnyRecord & { baseUpdatedAt?: unknown };
    if (entity === 'billOccurrences' && !(await one('SELECT 1 FROM bills WHERE id = ?', [incoming.billId as string]))) return;
    if (entity === 'eventOccurrences' && !(await one('SELECT 1 FROM events WHERE id = ?', [incoming.eventId as string]))) return;
    if (entity === 'categories') {
      const clash = await one('SELECT id FROM categories WHERE type = ? AND name = ? AND id <> ?', [incoming.type as string, incoming.name as string, incoming.id]);
      if (clash) await renameLocal('categories', String(clash.id), incoming.id);
    }
    const local = entity === 'auditLogs' ? null : await loadRecord(entity, incoming.id);
    let result: AnyRecord = local ? fillMissing(local, incoming as AnyRecord) : (incoming as AnyRecord);
    if (local && (await hasPending(entity, incoming.id, pendingAfter))) {
      type Occ = AnyRecord & { updatedAt: string; statusChangedAt: string | null; isModified: boolean };
      result =
        entity === 'billOccurrences'
          ? mergeOccurrence(local as Occ, incoming as Occ, BILL_STATUS_FIELDS).record
          : entity === 'eventOccurrences'
            ? mergeOccurrence(local as Occ, incoming as Occ, EVENT_STATUS_FIELDS).record
            : mergeRecord(local as AnyRecord & { updatedAt: string }, incoming as AnyRecord & { updatedAt: string }).record;
    }
    await writeRecord(entity, result);
    if (entity !== 'auditLogs') await setBase(entity, incoming.id, String(incoming.updatedAt));
  }

  async function applySettings(incoming: SyncSettings, pendingAfter = 0) {
    const { baseUpdatedAt: _b, ...record } = incoming as SyncSettings & { baseUpdatedAt?: unknown };
    const result = (await hasPending('settings', 'settings', pendingAfter)) ? mergeRecord(await loadSettings(), record).record : record;
    await writeSettings(result);
    await setBase('settings', 'settings', record.updatedAt);
  }

  // ── state ──

  async function getState(): Promise<SyncState> {
    const rows = await db.all<{ key: string; value: string }>("SELECT key, value FROM sync_state WHERE key <> 'applying'");
    return Object.fromEntries(rows.map((r) => [r.key, r.value])) as SyncState;
  }

  async function setState(patch: Partial<Record<keyof SyncState, string | null>>) {
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) await db.run('DELETE FROM sync_state WHERE key = ?', [key]);
      else await db.run('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
    }
  }

  return {
    getState,
    setState,

    /** Forget the server connection. Local data stays. */
    async clear() {
      await db.run('DELETE FROM outbox');
      await db.run('DELETE FROM sync_base');
      await db.run('DELETE FROM sync_state');
    },

    async pendingCount(): Promise<number> {
      return Number((await one('SELECT COUNT(*) AS n FROM (SELECT DISTINCT entity_type, entity_id FROM outbox)'))?.n ?? 0);
    },

    /** Counts for the connect preview. */
    async summary() {
      const names = async (sql: string) => (await db.all<{ n: string }>(sql)).map((r) => r.n);
      return {
        bills: await names('SELECT name AS n FROM bills'),
        events: await names('SELECT title AS n FROM events'),
      };
    },

    /** "Combine": queue everything on the phone for upload. */
    async enqueueAll() {
      for (const [entity, table] of Object.entries(SYNC_TABLE)) {
        await db.run(`INSERT INTO outbox (entity_type, entity_id, op, created_at) SELECT ?, id, 'upsert', ? FROM ${table}`, [entity, new Date().toISOString()]);
      }
      await db.run("INSERT INTO outbox (entity_type, entity_id, op, created_at) VALUES ('settings', 'settings', 'upsert', ?)", [new Date().toISOString()]);
    },

    /** "Use the server's data": empty the synced tables (profile and settings stay until the server's arrive). */
    async wipeForReplace() {
      await applying(true);
      for (const table of ['event_occurrences', 'bill_occurrences', 'events', 'bills', 'categories', 'notifications', 'audit_logs']) await run(`DELETE FROM ${table}`);
      await db.run('DELETE FROM outbox');
      await db.run('DELETE FROM sync_base');
      await applying(false);
    },

    /** The next batch of local changes, parents first. Null when nothing is waiting. */
    async collectPush(maxRows: number): Promise<PushBatch | null> {
      const groups = await db.all<{ entity_type: string; entity_id: string; seq: number; op: string; at: string }>(`
        SELECT o.entity_type, o.entity_id, o.seq, o.op, o.created_at AS at FROM outbox o
        WHERE o.seq = (SELECT MAX(seq) FROM outbox x WHERE x.entity_type = o.entity_type AND x.entity_id = o.entity_id)`);
      if (!groups.length) return null;
      groups.sort((a, b) => PUSH_ORDER.indexOf(a.entity_type as SyncEntity) - PUSH_ORDER.indexOf(b.entity_type as SyncEntity) || a.seq - b.seq);
      const upTo = Number((await one('SELECT MAX(seq) AS m FROM outbox'))!.m);
      const batch: PushBatch = { changes: {}, deletes: [], keys: [], upTo, size: 0 };
      for (const g of groups.slice(0, maxRows)) {
        batch.keys.push([g.entity_type, g.entity_id]);
        if (g.entity_type === 'settings') {
          batch.changes.settings = { ...(await loadSettings()), baseUpdatedAt: (await getBase('settings', 'settings')) ?? null };
          batch.size++;
          continue;
        }
        const entity = g.entity_type as SyncEntity;
        const record = await loadRecord(entity, g.entity_id);
        if (record) {
          const list = ((batch.changes as Record<string, unknown[]>)[entity] ??= []);
          list.push(entity === 'auditLogs' ? record : { ...record, baseUpdatedAt: (await getBase(entity, g.entity_id)) ?? null });
          batch.size++;
        } else if (g.op === 'delete' && entity !== 'auditLogs') {
          batch.deletes.push({ entity, id: g.entity_id, deletedAt: g.at });
          batch.size++;
        }
      }
      return batch;
    },

    /** The server answered a push: clear what was sent and take on its corrections. */
    async applyPushResult(batch: PushBatch, response: PushResponse) {
      await applying(true);
      for (const [entity, id] of batch.keys) await run('DELETE FROM outbox WHERE entity_type = ? AND entity_id = ? AND seq <= ?', [entity, id, batch.upTo]);
      for (const [entity, list] of Object.entries(batch.changes)) {
        if (entity === 'settings') {
          if (list) await setBase('settings', 'settings', (list as SyncSettings).updatedAt);
        } else if (entity !== 'auditLogs') {
          for (const r of list as AnyRecord[]) await setBase(entity, r.id, String(r.updatedAt));
        }
      }
      for (const m of response.remapped) await renameLocal(m.entity, m.from, m.to);
      for (const a of response.adopt) {
        if (a.entity === 'settings') await applySettings(a.record, batch.upTo);
        else await applyIncoming(a.entity, a.record as unknown as AnyRecord, batch.upTo);
      }
      for (const r of response.remove) await deleteLocal(r.entity, r.id);
      await applying(false);
    },

    /** Applies one page from the server and stores its cursor. */
    async applyPull(page: PullResponse) {
      await applying(true);
      if (page.changes.settings) await applySettings(page.changes.settings);
      for (const entity of ['categories', 'bills', 'events', 'billOccurrences', 'eventOccurrences', 'auditLogs'] as SyncEntity[]) {
        for (const r of page.changes[entity] as unknown as AnyRecord[]) await applyIncoming(entity, r);
      }
      const order: SyncEntity[] = ['billOccurrences', 'eventOccurrences', 'bills', 'events', 'categories'];
      for (const entity of order) for (const d of page.deletes.filter((x) => x.entity === entity)) await deleteLocal(d.entity, d.id);
      await applying(false);
      await setState({ cursor: page.cursor });
    },
  };
}

export type SyncStore = ReturnType<typeof createSyncStore>;
