#!/usr/bin/env node
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [action, rawFile, confirmation] = process.argv.slice(2);
if (!['backup','restore'].includes(action) || !rawFile) {
  console.error('Usage: node tools/ops/postgres.mjs backup <file> | restore <file> --confirm-replace');
  process.exit(2);
}
if (action === 'restore' && confirmation !== '--confirm-replace') {
  console.error('Restore replaces database content. Add --confirm-replace and stop all ChatPM services.');
  process.exit(2);
}
const env = {...process.env};
if (env.DATABASE_URL) {
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected a PostgreSQL URL');
  env.PGHOST = url.hostname;
  env.PGPORT = url.port || '5432';
  env.PGUSER = decodeURIComponent(url.username);
  env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  if (url.searchParams.has('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');
  delete env.DATABASE_URL;
}
if (!env.PGDATABASE || !env.PGHOST || !env.PGUSER)
  throw new Error('DATABASE_URL or PGHOST/PGUSER/PGDATABASE required');
const file = resolve(rawFile);
if (action === 'backup') {
  mkdirSync(dirname(file),{recursive:true});
  if (existsSync(file)) throw new Error('Backup file already exists: '+file);
} else if (!existsSync(file)) {
  throw new Error('Backup file not found: '+file);
}
const binary = action === 'backup' ? 'pg_dump' : 'pg_restore';
const args = action === 'backup'
  ? ['--format=custom','--no-owner','--no-privileges','--file',file]
  : ['--clean','--if-exists','--no-owner','--no-privileges','--exit-on-error','--dbname',env.PGDATABASE,file];
const run = spawnSync(binary,args,{env,stdio:'inherit'});
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status || 1);
console.log(action === 'backup' ? 'Backup completed: '+file : 'Restore completed: '+file);
