/* eslint-disable no-console */
/**
 * Administration CLI. Run inside the backend container, e.g.:
 *   docker compose exec backend node dist/cli.js list-users
 *   docker compose exec backend node dist/cli.js reset-password me@example.com
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import webpush from 'web-push';
import { prisma } from './lib/prisma';
import { hashPassword, revokeAllSessions } from './modules/auth/auth.service';

const usage = `BillFlow admin CLI

Commands:
  list-users                              List all accounts
  reset-password <email> [new-password]   Reset a password (random one generated if omitted)
  set-role <email> <ADMIN|USER>           Change a user's role
  disable-user <email>                    Disable an account and sign it out everywhere
  enable-user <email>                     Re-enable an account
  unlock-user <email>                     Clear a failed-login lockout
  migrate-status                          Show which database migrations are applied
  generate-vapid-keys                     Print a VAPID key pair for Web Push
`;

async function findUser(email?: string) {
  if (!email) throw new Error('Email is required');
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new Error(`No user with email ${email}`);
  return user;
}

async function run(argv: string[]) {
  const [cmd, a, b] = argv;
  switch (cmd) {
    case 'list-users': {
      const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
      console.table(
        users.map((u) => ({
          email: u.email,
          name: u.displayName,
          role: u.role,
          active: u.isActive,
          verified: Boolean(u.emailVerifiedAt),
          lastLogin: u.lastLoginAt?.toISOString() ?? '-',
        })),
      );
      return;
    }
    case 'reset-password': {
      const user = await findUser(a);
      const pw = b ?? crypto.randomBytes(12).toString('base64url');
      if (pw.length < 8) throw new Error('Password must be at least 8 characters');
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(pw), failedLoginCount: 0, lockedUntil: null },
      });
      await revokeAllSessions(user.id);
      await prisma.auditLog.create({
        data: { userId: user.id, actorType: 'SYSTEM', entityType: 'USER', entityId: user.id, action: 'PASSWORD_RESET_CLI' },
      });
      console.log(`Password for ${user.email} reset.${b ? '' : ` New password: ${pw}`}`);
      return;
    }
    case 'set-role': {
      const user = await findUser(a);
      const role = b?.toUpperCase();
      if (role !== 'ADMIN' && role !== 'USER') throw new Error('Role must be ADMIN or USER');
      await prisma.user.update({ where: { id: user.id }, data: { role } });
      await revokeAllSessions(user.id);
      console.log(`${user.email} is now ${role}.`);
      return;
    }
    case 'disable-user':
    case 'enable-user': {
      const user = await findUser(a);
      const isActive = cmd === 'enable-user';
      await prisma.user.update({ where: { id: user.id }, data: { isActive } });
      if (!isActive) await revokeAllSessions(user.id);
      console.log(`${user.email} ${isActive ? 'enabled' : 'disabled'}.`);
      return;
    }
    case 'unlock-user': {
      const user = await findUser(a);
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
      console.log(`${user.email} unlocked.`);
      return;
    }
    case 'migrate-status': {
      // DATABASE_URL was derived from POSTGRES_* by config/env (imported via prisma).
      const cli = require.resolve('prisma/build/index.js');
      const r = spawnSync(process.execPath, [cli, 'migrate', 'status'], { stdio: 'inherit', env: process.env });
      process.exitCode = r.status ?? 1;
      return;
    }
    case 'generate-vapid-keys': {
      const keys = webpush.generateVAPIDKeys();
      console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`);
      return;
    }
    default:
      console.log(usage);
      if (cmd && cmd !== 'help') process.exitCode = 1;
  }
}

run(process.argv.slice(2))
  .catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
