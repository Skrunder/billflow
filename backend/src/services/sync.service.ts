import { Prisma } from '@prisma/client';
import {
  BILL_STATUS_FIELDS,
  EVENT_STATUS_FIELDS,
  mergeOccurrence,
  mergeRecord,
  pushRequest,
  type DeletableEntity,
  type MergeResult,
  type PullResponse,
  type PushResponse,
  type SyncChanges,
  type SyncDelete,
} from '@skr/core';
import { conflict, forbidden } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { parse } from '../lib/validate';
import { audit, type EntityType } from './audit.service';
import { recomputeInstants } from './occurrence.service';
import { getSettings } from './settings.service';
import {
  auditToSync,
  billFromSync,
  billOccurrenceFromSync,
  billOccurrenceToSync,
  billToSync,
  categoryFromSync,
  categoryToSync,
  eventFromSync,
  eventOccurrenceFromSync,
  eventOccurrenceToSync,
  eventToSync,
  settingsFromSync,
  settingsToSync,
} from './sync.mappers';

/**
 * Sync for the Android app (docs/API.md, "Sync").
 *
 * Change tracking is done in the database: a trigger stamps every write to a
 * synced table with the writing transaction's id (sync_xid) and every delete
 * leaves a tombstone. A pull returns rows with sync_xid >= the device's
 * cursor; the next cursor is the snapshot's xmin (every transaction below it
 * has finished), so a transaction that commits late is never skipped. Rows
 * may therefore arrive twice; devices apply them idempotently.
 *
 * Pushes are merged with the shared rules in @skr/core (mergeRecord /
 * mergeOccurrence). The web app is untouched: its writes are tracked by the
 * same triggers.
 */

/** Audit entries that describe synced data (sign-ins, sessions etc. stay on the server). */
const SYNCED_AUDIT_TYPES = ['SETTINGS', 'CATEGORY', 'BILL', 'BILL_OCCURRENCE', 'EVENT', 'EVENT_OCCURRENCE'];
export const DEFAULT_PULL_LIMIT = 2000;

type Tx = Prisma.TransactionClient;

// ─────────────────────────────────────────────────────────── pull ──

export function parseCursor(value: unknown): bigint {
  return typeof value === 'string' && /^\d{1,19}$/.test(value) ? BigInt(value) : 0n;
}

export async function pull(userId: string, since: bigint, limit = DEFAULT_PULL_LIMIT): Promise<PullResponse> {
  const [snapshot] = await prisma.$queryRaw<{ xmin: string }[]>`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`;
  const watermark = BigInt(snapshot!.xmin);
  const auditTypes = Prisma.join(SYNCED_AUDIT_TYPES);

  // How many changed rows each transaction left, to cut pages at transaction boundaries.
  const groups = await prisma.$queryRaw<{ xid: bigint; n: bigint }[]>`
    SELECT sync_xid AS xid, count(*) AS n FROM (
      SELECT sync_xid FROM user_settings WHERE user_id = ${userId}::uuid AND sync_xid >= ${since}
      UNION ALL SELECT sync_xid FROM categories WHERE user_id = ${userId}::uuid AND sync_xid >= ${since}
      UNION ALL SELECT sync_xid FROM bills WHERE user_id = ${userId}::uuid AND sync_xid >= ${since}
      UNION ALL SELECT sync_xid FROM events WHERE user_id = ${userId}::uuid AND sync_xid >= ${since}
      UNION ALL SELECT sync_xid FROM bill_occurrences WHERE user_id = ${userId}::uuid AND sync_xid >= ${since}
      UNION ALL SELECT sync_xid FROM event_occurrences WHERE user_id = ${userId}::uuid AND sync_xid >= ${since}
      UNION ALL SELECT sync_xid FROM audit_logs WHERE user_id = ${userId}::uuid AND sync_xid >= ${since} AND entity_type IN (${auditTypes})
      UNION ALL SELECT sync_xid FROM sync_tombstones WHERE user_id = ${userId}::uuid AND sync_xid >= ${since}
    ) changed GROUP BY sync_xid ORDER BY sync_xid`;

  let upper: bigint | null = null;
  let total = 0;
  for (let i = 0; i < groups.length; i++) {
    total += Number(groups[i]!.n);
    if (total >= limit && i + 1 < groups.length) {
      upper = groups[i + 1]!.xid;
      break;
    }
  }
  const syncXid = upper === null ? { gte: since } : { gte: since, lt: upper };
  let cursor = upper === null || upper > watermark ? watermark : upper;
  if (cursor < since) cursor = since;

  const where = { userId, syncXid };
  const [settings, categories, bills, events, billOccurrences, eventOccurrences, auditLogs, tombstones] = await Promise.all([
    prisma.userSettings.findFirst({ where }),
    prisma.category.findMany({ where }),
    prisma.bill.findMany({ where }),
    prisma.event.findMany({ where }),
    prisma.billOccurrence.findMany({ where }),
    prisma.eventOccurrence.findMany({ where }),
    prisma.auditLog.findMany({ where: { ...where, entityType: { in: SYNCED_AUDIT_TYPES } } }),
    prisma.syncTombstone.findMany({ where, orderBy: { id: 'asc' } }),
  ]);

  return {
    changes: {
      settings: settings ? settingsToSync(settings) : null,
      categories: categories.map(categoryToSync),
      bills: bills.map(billToSync),
      events: events.map(eventToSync),
      billOccurrences: billOccurrences.map(billOccurrenceToSync),
      eventOccurrences: eventOccurrences.map(eventOccurrenceToSync),
      auditLogs: auditLogs.map(auditToSync),
    },
    deletes: await liveTombstones(userId, tombstones),
    cursor: cursor.toString(),
    hasMore: upper !== null && cursor > since,
    serverTime: new Date().toISOString(),
  };
}

/** Tombstones for rows that are really gone (a row can be re-created with the same id). */
async function liveTombstones(userId: string, tombstones: { entityType: string; entityId: string }[]): Promise<SyncDelete[]> {
  const byEntity = new Map<DeletableEntity, Set<string>>();
  for (const t of tombstones) {
    const entity = t.entityType as DeletableEntity;
    if (!byEntity.has(entity)) byEntity.set(entity, new Set());
    byEntity.get(entity)!.add(t.entityId);
  }
  const out: SyncDelete[] = [];
  for (const [entity, idSet] of byEntity) {
    const ids = [...idSet];
    const select = { where: { userId, id: { in: ids } }, select: { id: true } } as const;
    const existing =
      entity === 'categories'
        ? await prisma.category.findMany(select)
        : entity === 'bills'
          ? await prisma.bill.findMany(select)
          : entity === 'events'
            ? await prisma.event.findMany(select)
            : entity === 'billOccurrences'
              ? await prisma.billOccurrence.findMany(select)
              : await prisma.eventOccurrence.findMany(select);
    const alive = new Set(existing.map((r) => r.id));
    for (const id of ids) if (!alive.has(id)) out.push({ entity, id });
  }
  return out;
}

// ─────────────────────────────────────────────────────────── push ──

const touched = (o: { isModified: boolean; statusChangedAt: string | Date | null }) => o.isModified || o.statusChangedAt != null;

export async function push(userId: string, body: unknown): Promise<PushResponse> {
  const req = parse(pushRequest, body);
  const device = await prisma.device.findFirst({ where: { id: req.deviceId, userId, revokedAt: null } });
  if (!device) throw forbidden('This device is not signed in to this account');

  const previous = await prisma.syncBatch.findUnique({ where: { id: req.batchId } });
  if (previous) {
    if (previous.deviceId !== device.id) throw conflict('This batch id was already used');
    return previous.response as unknown as PushResponse;
  }

  let instantsChanged = false;
  let response: PushResponse;
  try {
    response = await prisma.$transaction(
      async (tx) => {
        // One push per user at a time, so two phones syncing together merge in order.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`;
        const merger = new PushMerger(tx, userId, device.id);
        instantsChanged = await merger.run(req.changes as SyncChanges, req.deletes);
        await tx.syncBatch.create({ data: { id: req.batchId, deviceId: device.id, response: merger.result as unknown as Prisma.InputJsonValue } });
        await tx.device.update({ where: { id: device.id }, data: { lastSyncAt: new Date() } });
        return merger.result;
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  } catch (err) {
    // The same batch arriving twice at once: answer with the first result.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const first = await prisma.syncBatch.findUnique({ where: { id: req.batchId } });
      if (first?.deviceId === device.id) return first.response as unknown as PushResponse;
    }
    throw err;
  }
  // Timezone or all-day time changed on the phone: fix instants of rows the phone hasn't seen yet.
  if (instantsChanged) await recomputeInstants(userId);
  return response;
}

class PushMerger {
  readonly result: PushResponse = { applied: 0, adopt: [], remove: [], remapped: [], conflicts: 0 };
  private categoryIds = new Map<string, string>();

  constructor(
    private readonly tx: Tx,
    private readonly userId: string,
    private readonly deviceId: string,
  ) {}

  async run(changes: SyncChanges, deletes: (SyncDelete & { deletedAt: string })[]): Promise<boolean> {
    const instantsChanged = changes.settings ? await this.settings(changes.settings) : false;
    for (const r of changes.categories) await this.category(r);
    const categories = await this.tx.category.findMany({ where: { userId: this.userId }, select: { id: true, type: true } });
    const categoryType = new Map(categories.map((c) => [c.id, c.type]));
    for (const r of changes.bills) await this.bill(r, categoryType);
    for (const r of changes.events) await this.event(r, categoryType);
    for (const r of changes.billOccurrences) await this.billOccurrence(r);
    for (const r of changes.eventOccurrences) await this.eventOccurrence(r);
    await this.auditLogs(changes.auditLogs);
    // Children first, so a kept occurrence is decided before its template goes.
    const order: DeletableEntity[] = ['billOccurrences', 'eventOccurrences', 'bills', 'events', 'categories'];
    for (const entity of order) for (const d of deletes.filter((x) => x.entity === entity)) await this.delete(d);
    return instantsChanged;
  }

  /** Records a concurrent edit (both sides changed the record) in its history. */
  private async conflict(entityType: EntityType, entityId: string, m: MergeResult<unknown>, existingUpdatedAt: string, base?: string | null) {
    if (!Object.keys(m.dropped).length) return;
    if (base && existingUpdatedAt <= base) return; // the server copy hadn't changed since the device last saw it
    this.result.conflicts++;
    await audit(this.tx, {
      userId: this.userId,
      actorType: 'SYSTEM',
      entityType,
      entityId,
      action: 'SYNC_CONFLICT',
      // Same shape as other history entries: the value that was replaced → the one kept.
      changes: Object.fromEntries(Object.entries(m.dropped).map(([k, v]) => [k, { from: v.discarded, to: v.kept }])) as Prisma.InputJsonValue,
      metadata: { deviceId: this.deviceId },
    });
  }

  private async tombstone(entity: DeletableEntity, id: string) {
    return this.tx.syncTombstone.findFirst({ where: { userId: this.userId, entityType: entity, entityId: id }, orderBy: { id: 'desc' } });
  }

  private async settings(incoming: NonNullable<SyncChanges['settings']>): Promise<boolean> {
    const { baseUpdatedAt, ...record } = incoming as typeof incoming & { baseUpdatedAt?: string | null };
    const current = settingsToSync(await getSettings(this.userId, this.tx));
    const m = mergeRecord(current, record);
    await this.conflict('SETTINGS', this.userId, m, current.updatedAt, baseUpdatedAt);
    if (m.winner !== 'existing') await this.tx.userSettings.update({ where: { userId: this.userId }, data: settingsFromSync(m.record) });
    if (m.winner === 'incoming') this.result.applied++;
    else this.result.adopt.push({ entity: 'settings', record: m.record });
    return m.winner !== 'existing' && (m.record.timezone !== current.timezone || m.record.allDayReminderTime !== current.allDayReminderTime);
  }

  private async category(incoming: SyncChanges['categories'][number]) {
    let { baseUpdatedAt, ...record } = incoming;
    let existing = await this.tx.category.findUnique({ where: { id: record.id } });
    if (existing && existing.userId !== this.userId) return;
    if (!existing) {
      if (await this.tombstone('categories', record.id)) return void this.result.remove.push({ entity: 'categories', id: record.id });
      // Same category created on both sides (e.g. the defaults): one row, the server's id.
      const twin = await this.tx.category.findUnique({ where: { userId_type_name: { userId: this.userId, type: record.type, name: record.name } } });
      if (twin) {
        this.categoryIds.set(record.id, twin.id);
        this.result.remapped.push({ entity: 'categories', from: record.id, to: twin.id });
        record = { ...record, id: twin.id };
        existing = twin;
        baseUpdatedAt = null;
      }
    }
    if (!existing) {
      await this.tx.category.create({ data: categoryFromSync(record, this.userId) });
      return void this.result.applied++;
    }
    const current = categoryToSync(existing);
    let m = mergeRecord(current, record);
    if (m.winner !== 'existing' && (m.record.name !== current.name || m.record.type !== current.type)) {
      const clash = await this.tx.category.findUnique({ where: { userId_type_name: { userId: this.userId, type: m.record.type, name: m.record.name } } });
      if (clash) m = { record: current, winner: 'existing', dropped: {} }; // the name is taken: keep the server's copy
    }
    await this.conflict('CATEGORY', current.id, m, current.updatedAt, baseUpdatedAt);
    if (m.winner !== 'existing') {
      const { id: _id, userId: _u, ...data } = categoryFromSync(m.record, this.userId);
      await this.tx.category.update({ where: { id: current.id }, data });
    }
    if (m.winner === 'incoming' && record.id === incoming.id) this.result.applied++;
    else this.result.adopt.push({ entity: 'categories', record: m.record });
  }

  /** A category reference that exists on the server with the right type, else none. */
  private categoryRef(id: string | null, type: 'BILL' | 'EVENT', categoryType: Map<string, string>) {
    const resolved = id ? (this.categoryIds.get(id) ?? id) : null;
    return resolved && categoryType.get(resolved) === type ? resolved : null;
  }

  private async bill(incoming: SyncChanges['bills'][number], categoryType: Map<string, string>) {
    const { baseUpdatedAt, ...sent } = incoming;
    const record = { ...sent, categoryId: this.categoryRef(sent.categoryId, 'BILL', categoryType) };
    const existing = await this.tx.bill.findUnique({ where: { id: record.id } });
    if (existing && existing.userId !== this.userId) return;
    if (!existing) {
      // Deleting a template wins over edits made to it elsewhere.
      if (await this.tombstone('bills', record.id)) return void this.result.remove.push({ entity: 'bills', id: record.id });
      await this.tx.bill.create({ data: billFromSync(record, this.userId) });
      if (record.categoryId !== sent.categoryId) this.result.adopt.push({ entity: 'bills', record });
      else this.result.applied++;
      return;
    }
    const current = billToSync(existing);
    const m = mergeRecord(current, record);
    await this.conflict('BILL', current.id, m, current.updatedAt, baseUpdatedAt);
    if (m.winner !== 'existing') {
      const { id: _id, userId: _u, ...data } = billFromSync(m.record, this.userId);
      await this.tx.bill.update({ where: { id: current.id }, data });
    }
    if (m.winner === 'incoming' && record.categoryId === sent.categoryId) this.result.applied++;
    else this.result.adopt.push({ entity: 'bills', record: m.record });
  }

  private async event(incoming: SyncChanges['events'][number], categoryType: Map<string, string>) {
    const { baseUpdatedAt, ...sent } = incoming;
    const record = { ...sent, categoryId: this.categoryRef(sent.categoryId, 'EVENT', categoryType) };
    const existing = await this.tx.event.findUnique({ where: { id: record.id } });
    if (existing && existing.userId !== this.userId) return;
    if (!existing) {
      if (await this.tombstone('events', record.id)) return void this.result.remove.push({ entity: 'events', id: record.id });
      await this.tx.event.create({ data: eventFromSync(record, this.userId) });
      if (record.categoryId !== sent.categoryId) this.result.adopt.push({ entity: 'events', record });
      else this.result.applied++;
      return;
    }
    const current = eventToSync(existing);
    const m = mergeRecord(current, record);
    await this.conflict('EVENT', current.id, m, current.updatedAt, baseUpdatedAt);
    if (m.winner !== 'existing') {
      const { id: _id, userId: _u, ...data } = eventFromSync(m.record, this.userId);
      await this.tx.event.update({ where: { id: current.id }, data });
    }
    if (m.winner === 'incoming' && record.categoryId === sent.categoryId) this.result.applied++;
    else this.result.adopt.push({ entity: 'events', record: m.record });
  }

  private async billOccurrence(incoming: SyncChanges['billOccurrences'][number]) {
    let { baseUpdatedAt, ...record } = incoming;
    const sentId = record.id;
    const bill = await this.tx.bill.findUnique({ where: { id: record.billId }, select: { userId: true } });
    if (!bill || bill.userId !== this.userId) return void this.result.remove.push({ entity: 'billOccurrences', id: sentId });

    let existing = await this.tx.billOccurrence.findUnique({ where: { id: record.id } });
    if (existing && existing.userId !== this.userId) return;
    if (!existing) {
      // The same schedule slot under another id (rows from before ids were deterministic).
      const twin = await this.tx.billOccurrence.findUnique({
        where: { billId_originalDueDate: { billId: record.billId, originalDueDate: new Date(`${record.originalDueDate}T00:00:00.000Z`) } },
      });
      if (twin) {
        this.result.remapped.push({ entity: 'billOccurrences', from: sentId, to: twin.id });
        record = { ...record, id: twin.id };
        existing = twin;
        baseUpdatedAt = null;
      }
    }
    if (!existing) {
      const gone = await this.tombstone('billOccurrences', record.id);
      // Removed here (template edit) while untouched there: stays removed. Acted on there later: comes back.
      if (gone && !(touched(record) && record.updatedAt > gone.deletedAt.toISOString())) {
        return void this.result.remove.push({ entity: 'billOccurrences', id: record.id });
      }
      await this.tx.billOccurrence.create({ data: billOccurrenceFromSync(record, this.userId) });
      return void this.result.applied++;
    }
    const current = billOccurrenceToSync(existing);
    const m = mergeOccurrence(current, record, BILL_STATUS_FIELDS);
    await this.conflict('BILL_OCCURRENCE', current.id, m, current.updatedAt, baseUpdatedAt);
    if (m.winner !== 'existing') {
      const { id: _id, userId: _u, billId: _b, ...data } = billOccurrenceFromSync(m.record, this.userId);
      await this.tx.billOccurrence.update({ where: { id: current.id }, data });
    }
    if (m.winner === 'incoming' && record.id === sentId) this.result.applied++;
    else this.result.adopt.push({ entity: 'billOccurrences', record: m.record });
  }

  private async eventOccurrence(incoming: SyncChanges['eventOccurrences'][number]) {
    let { baseUpdatedAt, ...record } = incoming;
    const sentId = record.id;
    const event = await this.tx.event.findUnique({ where: { id: record.eventId }, select: { userId: true } });
    if (!event || event.userId !== this.userId) return void this.result.remove.push({ entity: 'eventOccurrences', id: sentId });

    let existing = await this.tx.eventOccurrence.findUnique({ where: { id: record.id } });
    if (existing && existing.userId !== this.userId) return;
    if (!existing) {
      const twin = await this.tx.eventOccurrence.findUnique({
        where: { eventId_originalDate: { eventId: record.eventId, originalDate: new Date(`${record.originalDate}T00:00:00.000Z`) } },
      });
      if (twin) {
        this.result.remapped.push({ entity: 'eventOccurrences', from: sentId, to: twin.id });
        record = { ...record, id: twin.id };
        existing = twin;
        baseUpdatedAt = null;
      }
    }
    if (!existing) {
      const gone = await this.tombstone('eventOccurrences', record.id);
      if (gone && !(touched(record) && record.updatedAt > gone.deletedAt.toISOString())) {
        return void this.result.remove.push({ entity: 'eventOccurrences', id: record.id });
      }
      await this.tx.eventOccurrence.create({ data: eventOccurrenceFromSync(record, this.userId) });
      return void this.result.applied++;
    }
    const current = eventOccurrenceToSync(existing);
    const m = mergeOccurrence(current, record, EVENT_STATUS_FIELDS);
    await this.conflict('EVENT_OCCURRENCE', current.id, m, current.updatedAt, baseUpdatedAt);
    if (m.winner !== 'existing') {
      const { id: _id, userId: _u, eventId: _e, ...data } = eventOccurrenceFromSync(m.record, this.userId);
      await this.tx.eventOccurrence.update({ where: { id: current.id }, data });
    }
    if (m.winner === 'incoming' && record.id === sentId) this.result.applied++;
    else this.result.adopt.push({ entity: 'eventOccurrences', record: m.record });
  }

  /** History is append-only: entries are added once and never changed. */
  private async auditLogs(entries: SyncChanges['auditLogs']) {
    if (!entries.length) return;
    const ids = entries.map((e) => this.categoryIds.get(e.entityId) ?? e.entityId);
    const created = await this.tx.auditLog.createMany({
      data: entries.map((e, i) => ({
        id: e.id,
        userId: this.userId,
        actorType: e.actorType,
        entityType: e.entityType,
        entityId: ids[i]!,
        action: e.action,
        changes: e.changes == null ? Prisma.JsonNull : (e.changes as Prisma.InputJsonValue),
        metadata: { deviceId: this.deviceId },
        createdAt: new Date(e.createdAt),
      })),
      skipDuplicates: true,
    });
    this.result.applied += created.count;
  }

  private async delete(d: SyncDelete & { deletedAt: string }) {
    const where = { id: d.id, userId: this.userId };
    switch (d.entity) {
      case 'billOccurrences': {
        const row = await this.tx.billOccurrence.findFirst({ where });
        if (!row) return;
        // Paid, skipped or edited here after the phone dropped it: keep it.
        if (touched(row) && row.updatedAt.toISOString() > d.deletedAt) return void this.result.adopt.push({ entity: 'billOccurrences', record: billOccurrenceToSync(row) });
        await this.tx.billOccurrence.delete({ where: { id: row.id } });
        break;
      }
      case 'eventOccurrences': {
        const row = await this.tx.eventOccurrence.findFirst({ where });
        if (!row) return;
        if (touched(row) && row.updatedAt.toISOString() > d.deletedAt) return void this.result.adopt.push({ entity: 'eventOccurrences', record: eventOccurrenceToSync(row) });
        await this.tx.eventOccurrence.delete({ where: { id: row.id } });
        break;
      }
      case 'bills':
        if (!(await this.tx.bill.deleteMany({ where })).count) return;
        break;
      case 'events':
        if (!(await this.tx.event.deleteMany({ where })).count) return;
        break;
      case 'categories':
        if (!(await this.tx.category.deleteMany({ where })).count) return;
        break;
    }
    this.result.applied++;
  }
}

// ──────────────────────────────────────────────────── housekeeping ──

/** Tombstones are only needed until every device has pulled them; 180 days is plenty. */
export async function pruneSyncData(): Promise<{ tombstones: number; batches: number }> {
  const tombstones = await prisma.syncTombstone.deleteMany({ where: { deletedAt: { lt: new Date(Date.now() - 180 * 86_400_000) } } });
  const batches = await prisma.syncBatch.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } });
  return { tombstones: tombstones.count, batches: batches.count };
}
