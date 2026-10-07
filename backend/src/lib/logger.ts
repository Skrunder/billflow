import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  base: { service: 'skr-bill-calendar-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
  ...(env.LOG_PRETTY ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});
