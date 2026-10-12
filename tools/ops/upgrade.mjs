#!/usr/bin/env node
// Explicit native maintenance workflow. Does not silently stop services or roll back SQL.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { main as createBackup } from './backup.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

export function parseUpgradeArgs(argv) {
  if (!argv.includes('--confirm-services-stopped')) {
    throw new Error('Stop API, Worker and Web first; then use --confirm-services-stopped.');
  }
  const other = argv.filter(v => v !== '--confirm-services-stopped');
  if (other.some(v => !v.startsWith('--dir=')) || other.length > 1)
    throw new Error('Usage: upgrade.mjs --confirm-services-stopped [--dir=/private/backups]');
  return other;
}

export async function main(argv = process.argv.slice(2)) {
  const backupArgs = parseUpgradeArgs(argv);
  try {
    const result = await fetch('http://127.0.0.1:' + (process.env.API_PORT || '3001') + '/health',
      { signal: AbortSignal.timeout(2500) });
    if (result.ok) throw new Error('API is still running. Stop all ChatPM services before upgrading.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('still running')) throw error;
  }
  // Backup must succeed before installing a new build or applying any SQL migration.
  createBackup(backupArgs);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'setup:native'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0)
    throw new Error('Upgrade failed; keep services stopped, inspect logs, and restore only in an isolated recovery procedure.');
  console.log('Upgrade and migrations finished. Start services, run npm run doctor, and verify core flows.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e instanceof Error ? e.message : 'Upgrade failed'); process.exitCode = 1; });
}
