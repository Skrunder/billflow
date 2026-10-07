import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';
import { auditRouter } from './modules/audit/audit.routes';
import { authRouter } from './modules/auth/auth.routes';
import { billOccurrencesRouter } from './modules/bills/billOccurrences.routes';
import { billsRouter } from './modules/bills/bills.routes';
import { calendarRouter } from './modules/calendar/calendar.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { eventOccurrencesRouter } from './modules/events/eventOccurrences.routes';
import { eventsRouter } from './modules/events/events.routes';
import { healthRouter } from './modules/health/health.routes';
import { notificationsRouter, pushRouter } from './modules/notifications/notifications.routes';
import { usersRouter } from './modules/users/users.routes';

function parseTrustProxy(value: string): boolean | number | string {
  const v = value.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Correct client IPs / protocol behind Nginx Proxy Manager, Traefik, Cloudflare Tunnel, …
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts: env.cookieSecure ? undefined : false,
    }),
  );

  if (env.corsOrigins.length) {
    app.use(cors({ origin: env.corsOrigins, credentials: true }));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const api = Router();
  api.use('/health', healthRouter);
  api.use(apiLimiter);
  api.use('/auth', authRouter);

  // Everything below requires a valid access token.
  const secured = Router();
  secured.use(requireAuth);
  secured.use('/users', usersRouter);
  secured.use('/categories', categoriesRouter);
  secured.use('/bills', billsRouter);
  secured.use('/bill-occurrences', billOccurrencesRouter);
  secured.use('/events', eventsRouter);
  secured.use('/event-occurrences', eventOccurrencesRouter);
  secured.use('/calendar', calendarRouter);
  secured.use('/dashboard', dashboardRouter);
  secured.use('/notifications', notificationsRouter);
  secured.use('/push', pushRouter);
  secured.use('/audit', auditRouter);
  api.use(secured);

  app.use('/api/v1', api);
  // Unversioned alias for the health checks used by Docker.
  app.use('/api/health', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
