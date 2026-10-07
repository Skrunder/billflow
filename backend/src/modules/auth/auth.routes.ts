import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { email, parse, password, trimmed } from '../../lib/validate';
import { currentUser, requireAuth } from '../../middleware/auth';
import { requireCsrf } from '../../middleware/csrf';
import { authLimiter } from '../../middleware/rateLimit';
import { audit } from '../../services/audit.service';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  issueTokens,
  login,
  register,
  requestPasswordReset,
  resetPassword,
  revokeAllSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  sendVerificationEmail,
  verificationRequired,
  verifyEmail,
} from './auth.service';

export const authRouter = Router();

const clientInfo = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

/** Public server capabilities so the UI can adapt (e.g. hide "Sign up"). */
authRouter.get('/config', async (_req, res) => {
  const hasUsers = (await prisma.user.count()) > 0;
  res.json({
    registrationOpen: env.ALLOW_REGISTRATION || !hasUsers,
    needsSetup: !hasUsers,
    emailVerificationRequired: verificationRequired(),
    passwordResetEnabled: env.smtpEnabled,
    pushEnabled: env.pushEnabled,
    emailNotificationsEnabled: env.smtpEnabled,
  });
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parse(
    z.object({
      email,
      password,
      displayName: trimmed(80).min(1),
      timezone: z.string().max(64).optional(),
    }),
    req.body,
  );
  const user = await register(body, clientInfo(req));
  if (!user.emailVerifiedAt) {
    res.status(201).json({ verificationRequired: true, user: { email: user.email } });
    return;
  }
  res.status(201).json(await issueTokens(res, user, clientInfo(req)));
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1).max(200) }), req.body);
  const user = await login(body.email, body.password, clientInfo(req));
  res.json(await issueTokens(res, user, clientInfo(req)));
});

authRouter.post('/refresh', requireCsrf, async (req, res) => {
  try {
    res.json(await rotateRefreshToken(res, req.cookies?.[REFRESH_COOKIE], clientInfo(req)));
  } catch (err) {
    if ((err as { code?: string }).code !== 'TOKEN_ROTATED') clearAuthCookies(res);
    throw err;
  }
});

authRouter.post('/logout', requireCsrf, async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  res.status(204).end();
});

authRouter.post('/logout-all', requireAuth, async (req, res) => {
  const user = currentUser(req);
  await revokeAllSessions(user.id);
  await audit(prisma, { userId: user.id, entityType: 'USER', entityId: user.id, action: 'LOGOUT_ALL' });
  clearAuthCookies(res);
  res.status(204).end();
});

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  await requestPasswordReset(body.email);
  res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
  await resetPassword(body.token, body.password);
  clearAuthCookies(res);
  res.json({ ok: true });
});

authRouter.post('/verify-email', authLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
  await verifyEmail(body.token);
  res.json({ ok: true });
});

authRouter.post('/resend-verification', authLimiter, async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user && !user.emailVerifiedAt && verificationRequired()) await sendVerificationEmail(user);
  res.json({ ok: true });
});
