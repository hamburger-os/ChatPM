#!/usr/bin/env node
// Lightweight foreground process group; OS services/Compose remain production supervisors.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { startControl } from './process-control.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Next.js runs in apps/web; it does not discover the monorepo root .env by itself.
loadEnv({ path: resolve(root, '.env') });
const mode = process.argv[2];
if (!['dev', 'prod'].includes(mode)) {
  console.error('Usage: node tools/ops/run.mjs <dev|prod>');
  process.exit(2);
}

const path = (relative) => resolve(root, relative);
const entry = mode === 'dev'
  ? [
      ['api', 'node_modules/tsx/dist/cli.mjs', ['watch', 'apps/api/src/server.ts']],
      ['worker', 'node_modules/tsx/dist/cli.mjs', ['watch', 'apps/worker/src/worker.ts']],
      ['web', 'node_modules/next/dist/bin/next', ['dev', 'apps/web', '-p', '3000', '-H', '127.0.0.1']],
    ]
  : [
      ['api', 'dist/apps/api/src/server.js', []],
      ['worker', 'dist/apps/worker/src/worker.js', []],
      ['web', 'node_modules/next/dist/bin/next', ['start', 'apps/web', '-p', '3000', '-H', '127.0.0.1']],
    ];
const required = [...entry.map(([, file]) => file), '.env'];
if (mode === 'prod') required.push('apps/web/.next/BUILD_ID');
for (const file of required) {
  if (!existsSync(path(file))) {
    console.error('Missing ' + file + '. ' +
      (file === '.env' ? 'Create and configure .env first.' :
        mode === 'dev' ? 'Run npm ci first.' : 'Run npm ci && npm run build first.'));
    process.exit(1);
  }
}

const children = new Map();
let control;
let resolveDrained;
const drained=new Promise(resolve=>{resolveDrained=resolve;});
let finalized=false;
function finalize(){
  if(finalized)return;
  finalized=true;
  if(forceTimer)clearTimeout(forceTimer);
  control?.close();
  resolveDrained();
  process.exitCode=exitCode;
}
let stopping = false;
let exitCode = 0;
let forceTimer;
function stopAll(signal, failed = false, requested = false) {
  if (stopping) return;
  stopping = true;
  exitCode = failed ? (exitCode || 1) : requested ? 0 : (signal === 'SIGINT' ? 130 : 143);
  for (const [child, name] of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform === 'win32' && name === 'worker' && child.connected) {
      try { child.send({ type: 'chatpm:shutdown' }); }
      catch { child.kill(signal); }
    } else {
      child.kill(signal);
    }
  }
  if (children.size) {
    forceTimer = setTimeout(() => {
      for (const child of children.keys()) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }, 60_000);
    forceTimer.unref();
  } else finalize();
}
control=await startControl(root,()=>{
  stopAll('SIGTERM',false,true);
  return drained;
});
process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));

for (const [name, file, args] of entry) {
  const child = spawn(process.execPath, [path(file), ...args], {
    cwd: root,
    env: { ...process.env, NODE_ENV: mode === 'dev' ? 'development' : 'production' },
    stdio: name === 'worker' ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
    windowsHide: true,
  });
  children.set(child, name);
  child.on('error', (error) => {
    console.error(name + ' failed to start: ' + error.message);
    exitCode = 1;
    stopAll('SIGTERM', true);
  });
  child.on('close', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(name + ' stopped unexpectedly (' + (code ?? signal ?? 'unknown') + ').');
      exitCode = code || 1;
      stopAll('SIGTERM', true);
    }
    if (children.size === 0) finalize();
  });
}
console.log('ChatPM ' + mode + ': started API, Worker and Web in one terminal.');
