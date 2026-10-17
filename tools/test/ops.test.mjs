import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDockerEnv, assertSafeDockerBootstrap } from '../ops/deploy.mjs';

const template = [
  'NODE_ENV=development',
  'SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters',
  'WEB_ORIGIN=http://localhost:3000',
  'LLM_API_KEY=',
  '',
].join('\n');

test('new install generates both independent high-entropy secrets without touching unrelated settings', () => {
  const { text, generated } = prepareDockerEnv(template);
  assert.deepEqual(generated, ['SESSION_SECRET', 'MODEL_ENCRYPTION_KEY', 'POSTGRES_PASSWORD', 'BOOTSTRAP_TOKEN']);
  const session = text.match(/^SESSION_SECRET=([a-f0-9]{64})$/m)?.[1];
  const postgres = text.match(/^POSTGRES_PASSWORD=([a-f0-9]{64})$/m)?.[1];
  assert.ok(session);
  assert.ok(postgres);
  const bootstrap=text.match(/^BOOTSTRAP_TOKEN=([a-f0-9]{64})$/m)?.[1];
  assert.ok(bootstrap);
  assert.notEqual(session, postgres);
  assert.notEqual(bootstrap, session);
  assert.notEqual(bootstrap, postgres);
  assert.match(text, /^LLM_API_KEY=$/m);
  assert.match(text, /^WEB_ORIGIN=http:\/\/localhost:3000$/m);
});

test('rerun is idempotent and keeps user-provided secrets', () => {
  const once = prepareDockerEnv(template);
  const twice = prepareDockerEnv(once.text);
  assert.equal(twice.text, once.text);
  assert.deepEqual(twice.generated, []);
  const custom = prepareDockerEnv('SESSION_SECRET=' + 'a'.repeat(40) +
    '\nPOSTGRES_PASSWORD=my-password\nWEB_ORIGIN=https://chatpm.example\n');
  assert.deepEqual(custom.generated, ['MODEL_ENCRYPTION_KEY','BOOTSTRAP_TOKEN']);
  assert.match(custom.text, /^POSTGRES_PASSWORD=my-password$/m);
  assert.match(custom.text, /^WEB_ORIGIN=https:\/\/chatpm.example$/m);
});

test('weak existing session secret is rejected rather than silently overwritten', () => {
  assert.throws(() => prepareDockerEnv('SESSION_SECRET=weak\n'),
    /at least 32 characters/);
});

test('duplicate secret configuration is rejected', () => {
  assert.throws(() => prepareDockerEnv('SESSION_SECRET=' + 'a'.repeat(40) +
    '\nSESSION_SECRET=' + 'b'.repeat(40) + '\n'), /Duplicate setting/);
});

test('CRLF input remains CRLF', () => {
  const result = prepareDockerEnv(template.replaceAll('\n', '\r\n'));
  assert.equal(result.text.replaceAll('\r\n', '').includes('\n'), false);
});


import { backupName, listBackups } from '../ops/backup.mjs';
import { evaluateHealth } from '../ops/doctor.mjs';

test('private backup naming is sorted and retention never includes unrelated files', () => {
  const name = backupName(new Date('2026-10-13T02:30:00.000Z'), 'abcdef01');
  assert.equal(name, 'chatpm-20261013T023000Z-abcdef01.dump');
  assert.deepEqual(listBackups([
    'README.md', 'chatpm-20261012T023000Z-abcdef02.dump',
    name, 'chatpm-20261011T023000Z-abcdef02.partial',
  ]), [name, 'chatpm-20261012T023000Z-abcdef02.dump']);
});

test('health assessment fails closed for stale Worker and overdue outbox', () => {
  const input = {
    apiOk: true, heartbeatAgeSec: 20, successAgeSec: 25,
    overdue: 0, dead: 0, migrations: ['004_worker_health.sql'],
  };
  assert.deepEqual(evaluateHealth(input), { ok: true, issues: [] });
  assert.deepEqual(evaluateHealth({ ...input, heartbeatAgeSec: 300, overdue: 1 }).issues,
    ['WORKER_HEARTBEAT_STALE', 'OUTBOX_OVERDUE']);
  assert.deepEqual(evaluateHealth({ ...input, successAgeSec: null }).issues,
    ['WORKER_TICK_NOT_SUCCESSFUL']);
});

import { prepareNativeEnv, validateNativeEnv } from '../ops/bootstrap-native.mjs';

test('native installer generates secret but never accepts template database password', () => {
  const template = 'NODE_ENV=production\nDATABASE_URL=postgres://chatpm:chatpm@127.0.0.1:5432/chatpm\n' +
    'SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters\n' +
    'WEB_ORIGIN=http://localhost:3000\n';
  const prepared = prepareNativeEnv(template);
  assert.match(prepared, /^SESSION_SECRET=[a-f0-9]{64}$/m);
  assert.match(prepared, /^MODEL_ENCRYPTION_KEY=[a-f0-9]{64}$/m);
  assert.match(prepared, /^BOOTSTRAP_TOKEN=[a-f0-9]{64}$/m);
  assert.ok(validateNativeEnv(prepared).some(x => x.includes('DATABASE_URL')));
  const valid = prepared.replace('chatpm:chatpm@', 'chatpm:uniqueStrongPassword@');
  assert.deepEqual(validateNativeEnv(valid), []);
  assert.equal(prepareNativeEnv(valid), valid);
});

import { parseUpgradeArgs } from '../ops/upgrade.mjs';

test('native upgrade requires explicit maintenance acknowledgement', () => {
  assert.throws(() => parseUpgradeArgs([]), /Stop API/);
  assert.throws(() => parseUpgradeArgs(['--confirm-services-stopped', '--unsafe']), /Usage:/);
  assert.deepEqual(parseUpgradeArgs(['--confirm-services-stopped', '--dir=/secure/backups']),
    ['--dir=/secure/backups']);
});

test('existing PostgreSQL volume blocks missing or placeholder credentials', () => {
  assert.throws(() => assertSafeDockerBootstrap(['POSTGRES_PASSWORD'], true), /existing ChatPM PostgreSQL/);
  assert.throws(() => assertSafeDockerBootstrap(['SESSION_SECRET'], true), /Recover the original/);
  assert.doesNotThrow(() => assertSafeDockerBootstrap([], true));
  assert.doesNotThrow(() => assertSafeDockerBootstrap(['BOOTSTRAP_TOKEN'], true));
  assert.doesNotThrow(() => assertSafeDockerBootstrap(['SESSION_SECRET', 'POSTGRES_PASSWORD'], false));
});

import { parseRestoreArgs } from '../ops/restore.mjs';
import { postgresClientEnvironment } from '../ops/postgres-env.mjs';
import { readFileSync } from 'node:fs';

test('restore refuses operation without both explicit confirmations', () => {
  assert.throws(() => parseRestoreArgs([]), /--confirm-services-stopped/);
  assert.throws(() => parseRestoreArgs(['backup.dump', '--confirm-replace']), /--confirm-services-stopped/);
  assert.throws(() => parseRestoreArgs(['nonexistent.dump','--confirm-replace','--confirm-services-stopped']),
    /Backup file not found/);
});

test('native backup and restore share one PostgreSQL subprocess environment parser', () => {
  const input = {
    DATABASE_URL: 'postgresql://backup:s%40cr%3Aet@db.example:5544/pm?sslmode=require',
    PGHOST: 'stale-host', PGPORT: '1234', PGUSER: 'stale-user',
    PGPASSWORD: 'stale-password', PGDATABASE: 'stale-db',
    UNRELATED: 'preserved',
  };
  const result = postgresClientEnvironment(input);
  assert.deepEqual({
    host: result.PGHOST, port: result.PGPORT, user: result.PGUSER,
    password: result.PGPASSWORD, database: result.PGDATABASE,
    sslmode: result.PGSSLMODE,
  }, {
    host: 'db.example', port: '5544', user: 'backup',
    password: 's@cr:et', database: 'pm', sslmode: 'require',
  });
  assert.equal(result.UNRELATED, 'preserved');
  assert.equal(Object.hasOwn(result, 'DATABASE_URL'), false);
  assert.equal(input.PGHOST, 'stale-host', 'input must remain unchanged');
  const native = {
    PGHOST: '127.0.0.1', PGUSER: 'chatpm',
    PGDATABASE: 'chatpm', PGPORT: '5432',
  };
  assert.deepEqual(postgresClientEnvironment(native), native);
});

test('shared PostgreSQL environment rejects invalid or incomplete credentials', () => {
  assert.throws(() => postgresClientEnvironment({ DATABASE_URL: 'http://example.com/db' }),
    /Expected PostgreSQL DATABASE_URL/);
  assert.throws(() => postgresClientEnvironment({ PGHOST: 'localhost', PGUSER: 'chatpm' }),
    /Configure DATABASE_URL or PGHOST/);
  const result = postgresClientEnvironment({ DATABASE_URL: 'postgres://u:p@localhost/db' });
  assert.equal(result.PGPORT, '5432');
  assert.equal(result.PGDATABASE, 'db');
});

test('Web binds loopback natively and exposes container networking only when explicitly selected', () => {
  const scripts = JSON.parse(readFileSync('package.json','utf8')).scripts;
  assert.match(scripts['start:web'], /-H 127\.0\.0\.1$/);
  assert.match(scripts['start:web:container'], /-H 0\.0\.0\.0$/);
  assert.match(readFileSync('infra/docker/Dockerfile','utf8'),
    /CMD \["npm","run","start:web:container"\]/);
});

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { startControl, requestStop } from '../ops/process-control.mjs';

test('one command stops only its registered manager and cleans up local runtime state',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'chatpm-stop-'));
  let calls=0;
  let manager;
  try{
    manager=await startControl(dir,async()=>{
      calls++;
      await new Promise(resolve=>setTimeout(resolve,15));
      manager.close();
    });
    const state=JSON.parse(readFileSync(join(dir,'.chatpm-run.json'),'utf8'));
    assert.equal(state.pid,process.pid);
    const secondStart=await assert.rejects(startControl(dir,()=>{}),/already has a registered runner/);
    assert.equal(secondStart,undefined);
    assert.equal(await requestStop(dir),true);
    assert.equal(calls,1);
    assert.equal(existsSync(join(dir,'.chatpm-run.json')),false);
    assert.equal(await requestStop(dir),false);
  }finally{
    manager?.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('wrong token cannot shut down the manager',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'chatpm-deny-'));
  let calls=0;
  const manager=await startControl(dir,()=>{calls++;});
  try{
    const state=JSON.parse(readFileSync(join(dir,'.chatpm-run.json'),'utf8'));
    const message=await new Promise((resolve,reject)=>{
      const socket=connect({host:'127.0.0.1',port:state.port});
      socket.on('connect',()=>socket.write('0'.repeat(64)+'\n'));
      socket.once('data',buffer=>{resolve(buffer.toString('utf8'));socket.destroy();});
      socket.once('error',reject);
    });
    assert.equal(message.trim(),'DENIED');
    assert.equal(calls,0);
  }finally{manager.close();rmSync(dir,{recursive:true,force:true});}
});
test('stale state is cleared only after the old owner is no longer running',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'chatpm-stale-'));
  try{
    writeFileSync(join(dir,'.chatpm-run.json'),JSON.stringify({
      pid:2147483647,port:3000,token:'a'.repeat(64),
    }));
    assert.equal(await requestStop(dir),false);
    assert.equal(existsSync(join(dir,'.chatpm-run.json')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});


import {parseFingerprints,verifyFingerprints} from './restore-drill.mjs';

const fingerprintTestRows=[
  'public.schema_migrations|23|'+'a'.repeat(32),
  'public.users|2|'+'b'.repeat(32),
  'public.project_members|4|'+'c'.repeat(32),
].join('\n');

test('restored PostgreSQL data must agree table by table with all source fingerprints',()=>{
  assert.deepEqual(parseFingerprints(fingerprintTestRows).get('public.users'),
    {count:2,hash:'b'.repeat(32)});
  assert.deepEqual(verifyFingerprints(fingerprintTestRows,fingerprintTestRows),
    {tables:3,rows:29});
  assert.throws(()=>verifyFingerprints(fingerprintTestRows,
    fingerprintTestRows.replace('public.users|2|','public.users|1|')),
    /public.users/,'Row loss must be detected');
  assert.throws(()=>verifyFingerprints(fingerprintTestRows,
    fingerprintTestRows.replace('b'.repeat(32),'d'.repeat(32))),
    /public.users/,'Same row count but changed content must be detected');
  assert.throws(()=>verifyFingerprints(fingerprintTestRows,
    fingerprintTestRows.replace(/^public.project_members.*\n?/m,'')),
    /public.project_members/,'Missing tables must be detected');
  assert.throws(()=>verifyFingerprints(fingerprintTestRows,
    fingerprintTestRows.replace('public.users|2|','public.users|0|')),
    /public.users/,'Even a self-consistent but unseeded source must be rejected');
  assert.throws(()=>parseFingerprints(fingerprintTestRows+'\n'+fingerprintTestRows),
    /duplicated/,'Repeated names invalidate the verification record');
  assert.throws(()=>parseFingerprints('public.users|secret-password|abcdef'),
    /Invalid/,'Malformed or leaked plaintext must not be accepted');
});

test('isolated recovery executable refuses operation unless explicitly CI-authorized',()=>{
  const script=readFileSync('tools/test/restore-drill.mjs','utf8');
  assert.match(script,/CI!=='true'/);
  assert.match(script,/CHATPM_CI_RESTORE_DRILL!=='1'/);
  assert.match(script,/prefix='chatpm_restore_drill_'/);
  assert.match(script,/Stop Web\/API\/Worker writers/);
});
