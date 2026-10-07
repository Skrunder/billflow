import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from './logger';

export const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
  log: [
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
prisma.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));

/** Wait for the database to accept connections (containers may start in any order). */
export async function waitForDatabase(maxAttempts = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      logger.warn({ attempt, maxAttempts, err: (err as Error).message }, 'database not ready, retrying');
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
