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
