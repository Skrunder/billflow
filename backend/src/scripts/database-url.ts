/**
 * Prints the PostgreSQL connection URL built from POSTGRES_* variables, with
 * the password URL-encoded so any characters are safe. Used by the container
 * entrypoint before running migrations.
 */
const e = process.env;
if (e.DATABASE_URL) {
  process.stdout.write(e.DATABASE_URL);
} else {
  if (!e.POSTGRES_PASSWORD) {
    process.stderr.write('[config] Set either DATABASE_URL or POSTGRES_PASSWORD\n');
    process.exit(1);
  }
  const user = encodeURIComponent(e.POSTGRES_USER || 'billcalendar');
  const pass = encodeURIComponent(e.POSTGRES_PASSWORD);
  const host = e.POSTGRES_HOST || 'db';
  const port = e.POSTGRES_PORT || '5432';
  const db = encodeURIComponent(e.POSTGRES_DB || 'billcalendar');
  process.stdout.write(`postgresql://${user}:${pass}@${host}:${port}/${db}?schema=public`);
}
export {};
