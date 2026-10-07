import { env } from './config/env';
import { createApp } from './app';
import { logger } from './lib/logger';
import { prisma, waitForDatabase } from './lib/prisma';
import { startScheduler, stopScheduler } from './services/scheduler';
import { version } from './version';

async function main() {
  logger.info(
    {
      version,
      nodeEnv: env.NODE_ENV,
      appUrl: env.APP_URL,
      cookieSecure: env.cookieSecure,
      registration: env.ALLOW_REGISTRATION,
      smtp: env.smtpEnabled,
      webPush: env.pushEnabled,
      trustProxy: env.TRUST_PROXY,
    },
    "starting SKR's Bill Calendar API",
  );
  if (env.REQUIRE_EMAIL_VERIFICATION && !env.smtpEnabled) {
    logger.warn('REQUIRE_EMAIL_VERIFICATION is on but SMTP is not configured — verification is disabled');
  }

  await waitForDatabase();
  logger.info('database connection established');

  const server = createApp().listen(env.PORT, env.HOST, () => {
    logger.info({ host: env.HOST, port: env.PORT }, 'API listening');
  });
  server.keepAliveTimeout = 65_000; // > typical reverse proxy idle timeout

  if (env.SCHEDULER_ENABLED) startScheduler();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('shutdown complete');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
