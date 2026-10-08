import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Startup validation: every setting comes from environment variables and is
 * validated here once. The process refuses to start with a clear message if
 * anything is missing or malformed.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return def;
      const s = v.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'off'].includes(s)) return false;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Expected a boolean, got "${v}"` });
      return z.NEVER;
    });

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const int = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return def;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Expected an integer between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    });

const timezone = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const tz = v?.trim() || 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown IANA timezone "${tz}"` });
      return z.NEVER;
    }
  });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(4000, 1, 65535),
  APP_URL: z.string().url().default('http://localhost:8080'),
  DATA_DIR: optionalString,

  DATABASE_URL: optionalString,
  POSTGRES_HOST: z.string().default('db'),
  POSTGRES_PORT: int(5432, 1, 65535),
  POSTGRES_USER: z.string().default('billcalendar'),
  POSTGRES_PASSWORD: optionalString,
  POSTGRES_DB: z.string().default('billcalendar'),

  JWT_SECRET: optionalString,
  ACCESS_TOKEN_TTL_MINUTES: int(15, 1, 1440),
  REFRESH_TOKEN_TTL_DAYS: int(30, 1, 365),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
  CORS_ORIGINS: optionalString,

  ALLOW_REGISTRATION: bool(true),
  REQUIRE_EMAIL_VERIFICATION: bool(false),
  BCRYPT_ROUNDS: int(12, 10, 15),
  DEFAULT_TIMEZONE: timezone,

  RATE_LIMIT_WINDOW_MINUTES: int(15, 1, 1440),
  RATE_LIMIT_MAX: int(1000, 10, 100000),
  AUTH_RATE_LIMIT_MAX: int(20, 3, 10000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool(false),

  SMTP_HOST: optionalString,
  SMTP_PORT: int(587, 1, 65535),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: z.string().default("BillFlow <no-reply@localhost>"),

  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),

  SCHEDULER_ENABLED: bool(true),
  OCCURRENCE_HORIZON_DAYS: int(400, 31, 3650),
});

export type Env = z.infer<typeof schema> & {
  DATABASE_URL: string;
  JWT_SECRET: string;
  DATA_DIR: string;
  cookieSecure: boolean;
  smtpEnabled: boolean;
  pushEnabled: boolean;
  corsOrigins: string[];
};

function fail(message: string): never {
  // Logger is not initialised yet — write directly to stderr.
  process.stderr.write(`\n[config] ${message}\n\n`);
  process.exit(1);
}

/** Load the JWT secret from env, or generate one and persist it in DATA_DIR. */
function resolveJwtSecret(provided: string | undefined, dataDir: string): string {
  if (provided) {
    if (provided.length < 32) fail('JWT_SECRET must be at least 32 characters long.');
    return provided;
  }
  const file = path.join(dataDir, 'secrets', 'jwt_secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // fall through and create one
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    process.stderr.write(`[config] JWT_SECRET not set — generated one and stored it in ${file}\n`);
  } catch (err) {
    fail(`JWT_SECRET is not set and a secret could not be persisted to ${file}: ${(err as Error).message}`);
  }
  return secret;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
    fail(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;

  let databaseUrl = e.DATABASE_URL;
  if (!databaseUrl) {
    if (!e.POSTGRES_PASSWORD) fail('Set either DATABASE_URL or POSTGRES_PASSWORD (plus POSTGRES_HOST/USER/DB).');
    databaseUrl =
      `postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}` +
      `@${e.POSTGRES_HOST}:${e.POSTGRES_PORT}/${encodeURIComponent(e.POSTGRES_DB)}?schema=public`;
  }
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) fail('DATABASE_URL must start with postgresql://');

  const dataDir = e.DATA_DIR ?? (e.NODE_ENV === 'production' ? '/app/data' : path.resolve(process.cwd(), 'data'));
  const jwtSecret = resolveJwtSecret(e.JWT_SECRET, dataDir);

  const cookieSecure = e.COOKIE_SECURE === 'auto' ? e.APP_URL.startsWith('https://') : e.COOKIE_SECURE === 'true';

  if (Boolean(e.VAPID_PUBLIC_KEY) !== Boolean(e.VAPID_PRIVATE_KEY)) {
    fail('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together (or both left empty).');
  }

  return {
    ...e,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    DATA_DIR: dataDir,
    cookieSecure,
    smtpEnabled: Boolean(e.SMTP_HOST),
    pushEnabled: Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY),
    corsOrigins: (e.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const env: Env = loadEnv();
// Prisma reads DATABASE_URL from the environment.
process.env.DATABASE_URL = env.DATABASE_URL;
