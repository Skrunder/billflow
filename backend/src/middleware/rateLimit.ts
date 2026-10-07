import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const handler = (message: string) => ({
  error: { code: 'RATE_LIMITED', message },
});

/** General API limiter (per client IP; honours TRUST_PROXY). */
export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: handler('Too many requests, please slow down.'),
});

/** Strict limiter for credential endpoints (login, register, reset). */
export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: handler('Too many attempts. Please wait a few minutes and try again.'),
});
