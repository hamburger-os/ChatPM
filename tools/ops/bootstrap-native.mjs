#!/usr/bin/env node
// Native installer preflight: no privileged OS changes, no database creation or data deletion.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const envFile = resolve(root, '.env');
const placeholder = 'replace-with-a-long-random-secret-at-least-32-characters';

export function prepareNativeEnv(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const indices = lines.flatMap((line, index) => line.startsWith('SESSION_SECRET=') ? [index] : []);
  if (indices.length > 1) throw new Error('Duplicate SESSION_SECRET setting');
  const current = indices.length ? lines[indices[0]].slice('SESSION_SECRET='.length).trim() : '';
  if (current && current !== placeholder) return source;
  const value = 'SESSION_SECRET=' + randomBytes(32).toString('hex');
  if (indices.length) lines[indices[0]] = value;
  else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, value);
  return lines.join(newline);
}

export function validateNativeEnv(text) {
  const errors = [];
  const get = key => text.match(new RegExp('^' + key + '=(.*)$', 'm'))?.[1]?.trim();
  const db = get('DATABASE_URL');
  if (!db || db.includes('chatpm:chatpm@')) errors.push('Configure a dedicated PostgreSQL DATABASE_URL (do not use the template password).');
  else {
    try { if (!['postgres:', 'postgresql:'].includes(new URL(db).protocol)) throw new Error(); }
    catch { errors.push('DATABASE_URL must be a valid PostgreSQL URI.'); }
  }
  if (get('NODE_ENV') !== 'production') errors.push('Set NODE_ENV=production.');
  const secret = get('SESSION_SECRET');
  if (!secret || secret.length < 32 || /replace|example|changeme/i.test(secret))
    errors.push('Configure a strong SESSION_SECRET.');
  const origin = get('WEB_ORIGIN');
  if (!origin) errors.push('Configure WEB_ORIGIN.');
  else {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
    } catch { errors.push('WEB_ORIGIN must use HTTPS unless serving only local loopback.'); }
  }
  return errors;
}

export function main() {
  const source = existsSync(envFile)
    ? readFileSync(envFile, 'utf8')
    : readFileSync(resolve(root, '.env.example'), 'utf8').replace(/^NODE_ENV=.*/m, 'NODE_ENV=production');
  const next = prepareNativeEnv(source);
  if (!existsSync(envFile)) {
    writeFileSync(envFile, next, { flag: 'wx', mode: 0o600 });
    console.log('Created .env with a unique session secret.');
  } else if (source !== next) {
    writeFileSync(envFile, next, { mode: 0o600 });
    console.log('Updated missing/template session secret; other settings preserved.');
  }
  if (process.platform !== 'win32') chmodSync(envFile, 0o600);
  const errors = validateNativeEnv(next);
  if (errors.length) {
    console.error('Complete these preflight steps in .env, then rerun npm run setup:local:');
    for (const error of errors) console.error('- ' + error);
    process.exitCode = 2;
    return;
  }
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(executable, ['run', 'setup:native'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (err) { console.error(err instanceof Error ? err.message : 'Native setup failed'); process.exitCode = 1; }
}
