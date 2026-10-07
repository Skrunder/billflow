import type { UserSettings } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { Db } from './audit.service';

/** Settings row for a user, created with defaults on first access. */
export async function getSettings(userId: string, db: Db = prisma): Promise<UserSettings> {
  const existing = await db.userSettings.findUnique({ where: { userId } });
  if (existing) return existing;
  return db.userSettings.upsert({ where: { userId }, update: {}, create: { userId } });
}
