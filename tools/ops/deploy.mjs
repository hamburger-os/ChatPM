#!/usr/bin/env node
// Docker-only bootstrap. No database replacement, no global installation, no elevated access.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const exampleSecret = 'replace-with-a-long-random-secret-at-least-32-characters';

function generateSecret() {
  return randomBytes(32).toString('hex');
}

// Pure function for reproducible tests; returns newly generated keys, not their values.
export function prepareDockerEnv(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const generated = [];
  for (const key of ['SESSION_SECRET', 'POSTGRES_PASSWORD']) {
    const matches = lines.flatMap((line, index) =>
      line.match(new RegExp('^' + key + '=(.*)$')) ? [index] : []);
    if (matches.length > 1) throw new Error('Duplicate setting: ' + key);
    const index = matches[0];
    const raw = index === undefined ? '' : lines[index].slice(key.length + 1).trim();
    const placeholder = key === 'SESSION_SECRET' && raw === exampleSecret;
    if (key === 'SESSION_SECRET' && raw && !placeholder && raw.length < 32) {
      throw new Error('SESSION_SECRET must contain at least 32 characters. Existing value was preserved.');
    }
    if (!raw || placeholder) {
      const value = generateSecret();
      if (index === undefined) {
        lines.push(key + '=' + value);
      } else {
        lines[index] = key + '=' + value;
      }
      generated.push(key);
    }
  }
  return { text: lines.join(newline).replace(/(?:\r?\n)*$/, newline), generated };
}

function runDocker(args, silent = false) {
  const result = spawnSync('docker', args, {
    cwd: root, stdio: silent ? 'pipe' : 'inherit', encoding: silent ? 'utf8' : undefined,
  });
  if (result.error) throw new Error('Docker is unavailable: ' + result.error.message);
  if (result.status !== 0) {
    throw new Error(silent
      ? 'Docker Compose is unavailable. Install/start Docker Engine with the Compose plugin first.'
      : 'docker compose ' + args.join(' ') + ' failed with code ' + result.status);
  }
}

export function main() {
  runDocker(['compose', 'version'], true);
  const envPath = resolve(root, '.env');
  const source = existsSync(envPath)
    ? readFileSync(envPath, 'utf8')
    : readFileSync(resolve(root, '.env.example'), 'utf8');
  const { text, generated } = prepareDockerEnv(source);
  if (!existsSync(envPath)) {
    writeFileSync(envPath, text, { flag: 'wx', mode: 0o600 });
    console.log('Created .env with private local settings.');
  } else if (generated.length > 0) {
    writeFileSync(envPath, text, { mode: 0o600 });
    console.log('Added missing/placeholder Docker secrets to .env; other settings preserved.');
  }
  if (process.platform !== 'win32') chmodSync(envPath, 0o600);
  if (generated.length) console.log('Generated strong random values for ' + generated.join(', ') + '.');
  runDocker(['compose', '-f', 'infra/compose.prod.yml', 'up', '-d', '--build']);
  runDocker(['compose', '-f', 'infra/compose.prod.yml', 'ps']);
  console.log('ChatPM is available at http://localhost:3000 when its health checks pass.');
  console.log('Docker daemon startup is required for automatic restart after a host reboot.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
