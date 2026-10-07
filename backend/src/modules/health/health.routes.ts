import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { version } from '../../version';

export const healthRouter = Router();

/** Liveness: the process is up. */
healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', version, uptime: Math.round(process.uptime()) });
});

/** Readiness: the process can reach the database (used by Docker HEALTHCHECK). */
healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'ok', version });
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'unreachable', version });
  }
});
