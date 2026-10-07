import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { safeEqual } from '../lib/tokens';

export const CSRF_COOKIE = 'skr_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit CSRF protection for the only endpoints that authenticate via
 * cookie (refresh / logout). Every other endpoint requires a Bearer token held
 * in memory, which a cross-site request cannot attach.
 */
export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token');
  }
  next();
}
