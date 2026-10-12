import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDockerEnv } from '../ops/deploy.mjs';

const template = [
  'NODE_ENV=development',
  'SESSION_SECRET=replace-with-a-long-random-secret-at-least-32-characters',
  'WEB_ORIGIN=http://localhost:3000',
  'OPENAI_API_KEY=',
  '',
].join('\n');

test('new install generates both independent high-entropy secrets without touching unrelated settings', () => {
  const { text, generated } = prepareDockerEnv(template);
  assert.deepEqual(generated, ['SESSION_SECRET', 'POSTGRES_PASSWORD']);
  const session = text.match(/^SESSION_SECRET=([a-f0-9]{64})$/m)?.[1];
  const postgres = text.match(/^POSTGRES_PASSWORD=([a-f0-9]{64})$/m)?.[1];
  assert.ok(session);
  assert.ok(postgres);
  assert.notEqual(session, postgres);
  assert.match(text, /^OPENAI_API_KEY=$/m);
  assert.match(text, /^WEB_ORIGIN=http:\/\/localhost:3000$/m);
});

test('rerun is idempotent and keeps user-provided secrets', () => {
  const once = prepareDockerEnv(template);
  const twice = prepareDockerEnv(once.text);
  assert.equal(twice.text, once.text);
  assert.deepEqual(twice.generated, []);
  const custom = prepareDockerEnv('SESSION_SECRET=' + 'a'.repeat(40) +
    '\nPOSTGRES_PASSWORD=my-password\nWEB_ORIGIN=https://chatpm.example\n');
  assert.deepEqual(custom.generated, []);
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
  assert.ok(validateNativeEnv(prepared).some(x => x.includes('DATABASE_URL')));
  const valid = prepared.replace('chatpm:chatpm@', 'chatpm:uniqueStrongPassword@');
  assert.deepEqual(validateNativeEnv(valid), []);
  assert.equal(prepareNativeEnv(valid), valid);
});
