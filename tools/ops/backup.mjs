#!/usr/bin/env node
// Atomic private custom-format backups; retention is applied only after success.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const matching = /^chatpm-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump$/;

export function backupName(date = new Date(), suffix = randomBytes(4).toString('hex')) {
  return 'chatpm-' + date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') + '-' + suffix + '.dump';
}

export function listBackups(names) {
  return names.filter(name => matching.test(name)).sort().reverse();
}

function argsFromCli(argv) {
  const options = { dir: resolve(root, 'backups'), keep: 14, docker: false };
  for (const item of argv) {
    if (item === '--docker') options.docker = true;
    else if (item.startsWith('--dir=')) options.dir = resolve(item.slice(6));
    else if (item.startsWith('--keep=')) options.keep = Number(item.slice(7));
    else throw new Error('Usage: backup.mjs [--docker] [--dir=/private/backups] [--keep=14]');
  }
  if (!Number.isSafeInteger(options.keep) || options.keep < 1 || options.keep > 3650)
    throw new Error('--keep must be an integer between 1 and 3650');
  return options;
}

function pgEnvironment() {
  const env = { ...process.env };
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected PostgreSQL DATABASE_URL');
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

export function main(argv = process.argv.slice(2)) {
  const options = argsFromCli(argv);
  mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  const permissions = statSync(options.dir);
  if (!permissions.isDirectory()) throw new Error('Backup destination must be a directory');
  if (process.platform !== 'win32' && (permissions.mode & 0o077)) {
    throw new Error('Backup directory must not be accessible by group/others (chmod 700)');
  }
  const destination = join(options.dir, backupName());
  const temporary = destination + '.partial';
  let fd;
  let saved = false;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    const command = options.docker ? 'docker' : 'pg_dump';
    const pgArgs = ['--format=custom', '--no-owner', '--no-privileges'];
    const cmdArgs = options.docker
      ? ['compose', '-f', 'infra/compose.prod.yml', 'exec', '-T', 'postgres',
          'pg_dump', '-U', 'chatpm', '-d', 'chatpm', ...pgArgs]
      : pgArgs;
    const outcome = spawnSync(command, cmdArgs, {
      cwd: root,
      env: options.docker ? process.env : pgEnvironment(),
      stdio: ['ignore', fd, 'inherit'],
    });
    if (outcome.error || outcome.status !== 0)
      throw new Error('pg_dump failed: ' + (outcome.error?.name || outcome.status));
    const signature = Buffer.alloc(5);
    if (readSync(fd, signature, 0, 5, 0) !== 5 || signature.toString() !== 'PGDMP')
      throw new Error('pg_dump returned an invalid or empty archive');
    closeSync(fd); fd = undefined;
    renameSync(temporary, destination);
    saved = true;
    const old = listBackups(readdirSync(options.dir)).slice(options.keep);
    for (const name of old) {
      const target = join(options.dir, name);
      if (statSync(target).isFile()) unlinkSync(target);
    }
    console.log('Backup completed: ' + destination + ' (kept ' + options.keep + ' newest backups)');
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!saved && existsSync(temporary)) unlinkSync(temporary);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Backup failed');
    process.exitCode = 1;
  }
}
