#!/usr/bin/env node
// Destructive operation: explicit opt-in, service stop acknowledgement, isolated restore target.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresClientEnvironment } from './postgres-env.mjs';

export function parseRestoreArgs(argv) {
  if (argv.length !== 3 || argv[1] !== '--confirm-replace' ||
      argv[2] !== '--confirm-services-stopped')
    throw new Error('Usage: restore.mjs <custom-format.dump> --confirm-replace --confirm-services-stopped');
  const file = resolve(argv[0]);
  if (!existsSync(file)) throw new Error('Backup file not found: ' + file);
  return file;
}

export async function main(argv = process.argv.slice(2)) {
  const file = parseRestoreArgs(argv);
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(5);
    if (readSync(fd, header, 0, 5, 0) !== 5 || header.toString() !== 'PGDMP')
      throw new Error('Expected a PostgreSQL custom-format backup (PGDMP)');
  } finally {
    closeSync(fd);
  }

  // The caller must separately verify Web and Worker are stopped.
  // This check only prevents the most common accidental live restore.
  try {
    await fetch('http://127.0.0.1:' + (process.env.API_PORT || '3001') + '/health',
      { signal: AbortSignal.timeout(2500) });
  } catch {
    const env = postgresClientEnvironment();
    const run = spawnSync('pg_restore', [
      '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error',
      '--dbname', env.PGDATABASE, file,
    ], { env, stdio: 'inherit' });
    if (run.error || run.status !== 0)
      throw new Error('pg_restore failed: ' + (run.error?.name || run.status));
    console.log('Restore completed. Run npm run db:migrate:prod and verify in isolation.');
    return;
  }
  throw new Error('API is reachable; stop all ChatPM processes and use an isolated database.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Restore failed');
    process.exitCode = 1;
  });
}
