import type { SqlDriver } from './driver';

/**
 * On-device SQLite schema. Mirrors the server tables (see
 * backend/prisma/schema.prisma) with SQLite types:
 *   - calendar dates  → TEXT 'YYYY-MM-DD'
 *   - instants        → TEXT ISO-8601 UTC ('2026-10-15T14:00:00.000Z'), so
 *                       string comparison == time comparison
 *   - money           → TEXT decimal ('120.50'), summed in integer cents
 *   - booleans        → INTEGER 0/1
 *   - number arrays   → TEXT JSON ('[1440,60]')
 *
 * Templates and occurrences are separate tables; every occurrence is its own
 * row with its own status and audit history, exactly like the server.
 *
 * Migrations are append-only: never edit a released step, add a new one.
 * On Android each script is split into statements on `;` (native-driver.ts),
 * so scripts must not contain triggers or string literals with `;` or `--`.
 */
const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE profile (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    timezone TEXT NOT NULL,
    theme TEXT NOT NULL DEFAULT 'SYSTEM',
    week_starts_on INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    locale TEXT NOT NULL DEFAULT 'en-US',
    time_format TEXT NOT NULL DEFAULT '12h',
    default_calendar_view TEXT NOT NULL DEFAULT 'dayGridMonth',
    default_bill_reminders TEXT NOT NULL DEFAULT '[1440]',
    default_event_reminders TEXT NOT NULL DEFAULT '[60]',
    all_day_reminder_time TEXT NOT NULL DEFAULT '09:00',
    auto_complete_autopay INTEGER NOT NULL DEFAULT 1,
    in_app_notifications INTEGER NOT NULL DEFAULT 1,
    email_notifications INTEGER NOT NULL DEFAULT 0,
    push_notifications INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('BILL','EVENT')),
    color TEXT NOT NULL DEFAULT '#6366f1',
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (type, name)
  );

  CREATE TABLE bills (
    id TEXT PRIMARY KEY,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    notes TEXT,
    amount TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'MANUAL',
    scheduled_pay_days_before INTEGER,
    start_date TEXT NOT NULL,
    due_time TEXT,
    recurrence_frequency TEXT,
    recurrence_interval INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval >= 1),
    recurrence_by_weekday TEXT NOT NULL DEFAULT '[]',
    recurrence_end_date TEXT,
    recurrence_count INTEGER,
    reminder_offsets TEXT NOT NULL DEFAULT '[]',
    generated_until TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE bill_occurrences (
    id TEXT PRIMARY KEY,
    bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    original_due_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    due_time TEXT,
    due_at TEXT NOT NULL,
    amount TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','SKIPPED')),
    completed_at TEXT,
    amount_paid TEXT,
    confirmation_number TEXT,
    notes TEXT,
    scheduled_pay_date TEXT,
    autopay_at TEXT,
    is_modified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (bill_id, original_due_date),
    CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
  );
  CREATE INDEX bill_occ_due ON bill_occurrences (due_date);
  CREATE INDEX bill_occ_status_due ON bill_occurrences (status, due_date);

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    notes TEXT,
    location TEXT,
    start_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    recurrence_frequency TEXT,
    recurrence_interval INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval >= 1),
    recurrence_by_weekday TEXT NOT NULL DEFAULT '[]',
    recurrence_end_date TEXT,
    recurrence_count INTEGER,
    reminder_offsets TEXT NOT NULL DEFAULT '[]',
    generated_until TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE event_occurrences (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    original_date TEXT NOT NULL,
    event_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT,
    status TEXT NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING','COMPLETED','CANCELLED')),
    completed_at TEXT,
    cancelled_at TEXT,
    notes TEXT,
    is_modified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (event_id, original_date),
    CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
  );
  CREATE INDEX event_occ_date ON event_occurrences (event_date);

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    bill_occurrence_id TEXT REFERENCES bill_occurrences(id) ON DELETE CASCADE,
    event_occurrence_id TEXT REFERENCES event_occurrences(id) ON DELETE CASCADE,
    offset_minutes INTEGER NOT NULL,
    scheduled_for TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SENT','CANCELLED')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (bill_occurrence_id, offset_minutes),
    UNIQUE (event_occurrence_id, offset_minutes),
    CHECK (NOT (bill_occurrence_id IS NOT NULL AND event_occurrence_id IS NOT NULL))
  );

  -- Append-only history; no FK so it survives deletion of the entity.
  CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL DEFAULT 'USER',
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    changes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX audit_entity ON audit_logs (entity_type, entity_id, created_at);

  -- Sync bookkeeping (used from milestone 6): every local change is recorded
  -- here until it has been pushed to a server.
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings the database up to the latest schema. Safe to call on every start. */
export async function migrate(db: SqlDriver): Promise<void> {
  const hasMeta = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  let version = 0;
  if (hasMeta.length) {
    const row = await db.all<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
    version = Number(row[0]?.value ?? 0);
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`This database was created by a newer version of the app (schema ${version}). Please update the app.`);
  }
  for (let v = version; v < SCHEMA_VERSION; v++) {
    await db.exec('BEGIN');
    try {
      await db.exec(MIGRATIONS[v]!);
      await db.run("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
        String(v + 1),
      ]);
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
  }
}
