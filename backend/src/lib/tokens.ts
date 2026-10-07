import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { env } from '../config/env';

const ISSUER = 'skr-bill-calendar';
const AUDIENCE = 'skr-bill-calendar-web';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  /** User.tokenVersion at issue time — bumping it revokes the token. */
  tv: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof decoded !== 'object' || typeof decoded.sub !== 'string' || typeof decoded.tv !== 'number') {
    throw new Error('Malformed token');
  }
  return { sub: decoded.sub, role: decoded.role as UserRole, tv: decoded.tv };
}

/** Cryptographically random opaque token (refresh, reset, verification). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
