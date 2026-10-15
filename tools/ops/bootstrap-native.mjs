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
  let output=source;
  for (const [key,template] of [
    ['SESSION_SECRET',placeholder],
    ['MODEL_ENCRYPTION_KEY','replace-with-a-separate-long-random-model-key'],
    ['BOOTSTRAP_TOKEN',''],
  ]) {
    const lines=output.split(/\r?\n/);
    const matches=lines.flatMap((line,index)=>line.startsWith(key+'=')?[index]:[]);
    if(matches.length>1)throw new Error('Duplicate '+key+' setting');
    const raw=matches.length?lines[matches[0]].slice(key.length+1).trim():'';
    if(raw&&raw!==template){
      if(key==='BOOTSTRAP_TOKEN'&&!/^[a-fA-F0-9]{64}$/.test(raw))
        throw new Error('BOOTSTRAP_TOKEN must contain 64 hexadecimal characters');
      if(key!=='BOOTSTRAP_TOKEN'&&raw.length<32)
        throw new Error(key+' must contain at least 32 characters');
      continue;
    }
    const value=key+'='+randomBytes(32).toString('hex');
    if(matches.length)lines[matches[0]]=value;
    else lines.splice(lines.at(-1)===''?lines.length-1:lines.length,0,value);
    output=lines.join(source.includes('\r\n')?'\r\n':'\n');
  }
  return output;
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
  const modelKey=get('MODEL_ENCRYPTION_KEY');
  if(!modelKey||modelKey.length<32||/replace|example|changeme/i.test(modelKey))
    errors.push('Configure a strong MODEL_ENCRYPTION_KEY.');
  const registrationMode=get('REGISTRATION_MODE')||'bootstrap';
  if(registrationMode==='bootstrap'&&!/^[a-fA-F0-9]{64}$/.test(get('BOOTSTRAP_TOKEN')||''))
    errors.push('Set a 64-hex BOOTSTRAP_TOKEN for first-account operator verification.');
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
  console.log('Read first-account BOOTSTRAP_TOKEN from your private .env; never share it in chat.');
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
