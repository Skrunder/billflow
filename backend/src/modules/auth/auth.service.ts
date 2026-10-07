import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { env } from '../../config/env';
import { AppError, badRequest, conflict, forbidden, unauthorized } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sendMail, simpleHtml } from '../../lib/mailer';
import { prisma } from '../../lib/prisma';
import { randomToken, sha256, signAccessToken } from '../../lib/tokens';
import { isValidTimezone } from '@skr/core';
import { CSRF_COOKIE } from '../../middleware/csrf';
import { audit } from '../../services/audit.service';
import { DEFAULT_CATEGORIES } from '@skr/core';

export const REFRESH_COOKIE = 'skr_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
/** A just-rotated refresh token re-used within this window is a benign race (two tabs). */
const ROTATION_GRACE_MS = 60_000;

/** Precomputed hash so unknown-email logins cost the same as real ones. */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

export function publicUser(u: Pick<User, 'id' | 'email' | 'displayName' | 'role' | 'emailVerifiedAt' | 'createdAt'>) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    emailVerified: Boolean(u.emailVerifiedAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function verificationRequired() {
  return env.REQUIRE_EMAIL_VERIFICATION && env.smtpEnabled;
}

// ───────────────────────────────────────────────────── cookies ──

function setAuthCookies(res: Response, refreshToken: string) {
  const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000;
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge,
  });
  res.cookie(CSRF_COOKIE, randomToken(24), {
    httpOnly: false, // must be readable by the SPA for double-submit
    secure: env.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, secure: env.cookieSecure, sameSite: 'strict', httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { path: '/', secure: env.cookieSecure, sameSite: 'strict' });
}

// ──────────────────────────────────────────────────── sessions ──

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

async function createSession(userId: string, info: ClientInfo, familyId: string = crypto.randomUUID()) {
  const token = randomToken(32);
  await prisma.session.create({
    data: {
      userId,
      familyId,
      tokenHash: sha256(token),
      ipAddress: info.ip?.slice(0, 64),
      userAgent: info.userAgent?.slice(0, 300),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000),
    },
  });
  return token;
}

export async function issueTokens(res: Response, user: User, info: ClientInfo, familyId?: string) {
  const refreshToken = await createSession(user.id, info, familyId);
  setAuthCookies(res, refreshToken);
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion }),
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
    user: publicUser(user),
  };
}

// ─────────────────────────────────────────────── registration ──

export async function register(
  input: { email: string; password: string; displayName: string; timezone?: string },
  info: ClientInfo,
) {
  const userCount = await prisma.user.count();
  const isFirstUser = userCount === 0;
  if (!isFirstUser && !env.ALLOW_REGISTRATION) throw forbidden('Registration is disabled on this server');

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict('An account with this email already exists');

  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : env.DEFAULT_TIMEZONE;
  const passwordHash = await hashPassword(input.password);
  const autoVerify = isFirstUser || !verificationRequired();

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        role: isFirstUser ? 'ADMIN' : 'USER',
        emailVerifiedAt: autoVerify ? new Date() : null,
        settings: { create: { timezone } },
      },
    });
    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((c, i) => ({ ...c, userId: u.id, sortOrder: i })),
    });
    await audit(tx, {
      userId: u.id,
      entityType: 'USER',
      entityId: u.id,
      action: 'REGISTERED',
      metadata: { ip: info.ip ?? null, firstUser: isFirstUser },
    });
    return u;
  });

  logger.info({ userId: user.id, admin: isFirstUser }, 'user registered');
  if (!autoVerify) await sendVerificationEmail(user);
  return user;
}

// ────────────────────────────────────────────────────── login ──

export async function login(email: string, password: string, info: ClientInfo): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('Invalid email or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.');
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await audit(prisma, {
      userId: user.id,
      entityType: 'USER',
      entityId: user.id,
      action: failed >= MAX_FAILED_LOGINS ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      metadata: { ip: info.ip ?? null },
    });
    throw unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw forbidden('This account has been disabled');
  if (verificationRequired() && !user.emailVerifiedAt) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address before signing in');
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await audit(prisma, {
    userId: user.id,
    entityType: 'USER',
    entityId: user.id,
    action: 'LOGIN',
    metadata: { ip: info.ip ?? null, userAgent: info.userAgent?.slice(0, 300) ?? null },
  });
  return updated;
}

// ──────────────────────────────────────────── refresh rotation ──

export async function rotateRefreshToken(res: Response, token: string | undefined, info: ClientInfo) {
  if (!token) throw unauthorized('No session');
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session) throw unauthorized('Session not found');

  if (session.revokedAt) {
    if (Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS) {
      // Another tab rotated this token moments ago; the browser already has
      // the new cookie, so the client simply retries.
      throw new AppError(409, 'TOKEN_ROTATED', 'Session was just refreshed; retry');
    }
    // A long-rotated token being replayed means it was stolen: kill the family.
    await prisma.session.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(prisma, {
      userId: session.userId,
      entityType: 'SESSION',
      entityId: session.familyId,
      action: 'REFRESH_TOKEN_REUSE_DETECTED',
      metadata: { ip: info.ip ?? null },
    });
    logger.warn({ userId: session.userId }, 'refresh token reuse detected — session family revoked');
    throw unauthorized('Session revoked');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Session expired');
  if (!session.user.isActive) throw unauthorized('Account disabled');

  const revoked = await prisma.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date(), lastUsedAt: new Date() },
  });
  if (!revoked.count) throw new AppError(409, 'TOKEN_ROTATED', 'Session was just refreshed; retry');

  return issueTokens(res, session.user, info, session.familyId);
}

export async function revokeRefreshToken(token: string | undefined) {
  if (!token) return;
  await prisma.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Invalidate every access token and refresh session of a user. */
export async function revokeAllSessions(userId: string) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

// ────────────────────────────────────── password reset / verify ──

async function createOneTimeToken(userId: string, type: 'PASSWORD_RESET' | 'EMAIL_VERIFICATION', ttlMinutes: number) {
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.verificationToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
    }),
  ]);
  return token;
}

async function consumeOneTimeToken(token: string, type: 'PASSWORD_RESET' | 'EMAIL_VERIFICATION') {
  const row = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) {
    throw badRequest('This link is invalid or has expired');
  }
  const claimed = await prisma.verificationToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (!claimed.count) throw badRequest('This link is invalid or has expired');
  return row.userId;
}

export async function sendVerificationEmail(user: Pick<User, 'id' | 'email' | 'displayName'>) {
  const token = await createOneTimeToken(user.id, 'EMAIL_VERIFICATION', 48 * 60);
  const link = `${env.APP_URL}/verify-email?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Verify your email — SKR's Bill Calendar",
    text: `Hi ${user.displayName},\n\nConfirm your email address by opening this link:\n${link}\n\nThe link expires in 48 hours.`,
    html: simpleHtml('Verify your email', [`Hi ${user.displayName},`, 'Confirm your email address to finish setting up your account. The link expires in 48 hours.'], {
      href: link,
      label: 'Verify email',
    }),
  });
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always behave the same to avoid leaking which emails are registered.
  if (!user || !user.isActive) return;
  if (!env.smtpEnabled) {
    logger.warn(
      { userId: user.id },
      'password reset requested but SMTP is not configured — an administrator can reset it with the CLI (see docs)',
    );
    return;
  }
  const token = await createOneTimeToken(user.id, 'PASSWORD_RESET', 60);
  const link = `${env.APP_URL}/reset-password?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Reset your password — SKR's Bill Calendar",
    text: `Someone requested a password reset for your account.\n\nReset it here (valid for 1 hour):\n${link}\n\nIf this wasn't you, ignore this email.`,
    html: simpleHtml('Reset your password', ['Someone requested a password reset for your account. The link is valid for 1 hour.', "If this wasn't you, you can ignore this email."], {
      href: link,
      label: 'Reset password',
    }),
  });
  await audit(prisma, { userId: user.id, entityType: 'USER', entityId: user.id, action: 'PASSWORD_RESET_REQUESTED' });
}

export async function resetPassword(token: string, newPassword: string) {
  const userId = await consumeOneTimeToken(token, 'PASSWORD_RESET');
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
  });
  await revokeAllSessions(userId);
  await audit(prisma, { userId, entityType: 'USER', entityId: userId, action: 'PASSWORD_RESET' });
}

export async function verifyEmail(token: string) {
  const userId = await consumeOneTimeToken(token, 'EMAIL_VERIFICATION');
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  await audit(prisma, { userId, entityType: 'USER', entityId: userId, action: 'EMAIL_VERIFIED' });
}
