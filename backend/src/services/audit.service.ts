import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../lib/prisma';

export type Db = PrismaClient | Prisma.TransactionClient;

export type EntityType =
  | 'USER'
  | 'SETTINGS'
  | 'CATEGORY'
  | 'BILL'
  | 'BILL_OCCURRENCE'
  | 'EVENT'
  | 'EVENT_OCCURRENCE'
  | 'SESSION';

export interface AuditEntry {
  userId: string | null;
  entityType: EntityType;
  entityId: string;
  action: string;
  changes?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  actorType?: 'USER' | 'SYSTEM';
}

export function requestMeta(req: Request): Prisma.InputJsonValue {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 300) ?? null };
}

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId,
      actorType: entry.actorType ?? 'USER',
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      changes: entry.changes,
      metadata: entry.metadata,
    },
  });
}

/** Shallow diff of two plain objects, for audit `changes`. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Prisma.InputJsonValue {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = normalise(before[key]);
    const b = normalise(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = { from: a, to: b };
  }
  return out as Prisma.InputJsonValue;
}

function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && 'toFixed' in v) return String(v); // Prisma.Decimal
  return v ?? null;
}

export async function getHistory(userId: string, entityType: EntityType, entityId: string) {
  return prisma.auditLog.findMany({
    where: { userId, entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, action: true, actorType: true, changes: true, createdAt: true },
  });
}
