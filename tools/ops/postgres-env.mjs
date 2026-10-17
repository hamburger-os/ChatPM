// Shared PostgreSQL subprocess environment for native backup and restore.
// DATABASE_URL takes precedence over inherited PG* variables; never pass it through.
export function postgresClientEnvironment(source = process.env) {
  const env = { ...source };
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol))
      throw new Error('Expected PostgreSQL DATABASE_URL');
    env.PGHOST = url.hostname;
    env.PGPORT = url.port || '5432';
    env.PGUSER = decodeURIComponent(url.username);
    env.PGPASSWORD = decodeURIComponent(url.password);
    env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
    if (url.searchParams.has('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');
  }
  if (!env.PGHOST || !env.PGUSER || !env.PGDATABASE)
    throw new Error('Configure DATABASE_URL or PGHOST/PGUSER/PGDATABASE');
  delete env.DATABASE_URL;
  return env;
}
