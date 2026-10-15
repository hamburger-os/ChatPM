import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const workerPath=new URL('../../apps/worker/src/worker.ts',import.meta.url);
const heartbeatPath=new URL('../../packages/core/src/operations/worker-heartbeat.ts',import.meta.url);
const worker=readFileSync(workerPath,'utf8');
const heartbeat=readFileSync(heartbeatPath,'utf8');

function assertWorkerBootstrapBoundary(source){
  assert.doesNotMatch(source,/\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:[\s\S]{0,30}\b(?:FROM|INTO)\b)?/i,
    'Worker startup must not contain SQL queries');
  assert.doesNotMatch(source,/\b(?:pool|db)\.query\s*\(|\btransaction\s*\(|\baudit\s*\(/,
    'Worker bootstrap cannot mutate the domain database');
  for(const runner of ['processEvents','processReminders','processReports']){
    assert.match(source,new RegExp('\\b'+runner+'\\s*\\('),
      'Worker must dispatch '+runner+' from the bounded runner modules');
  }
  assert.match(source,/inFlight\\.has\\(lane\\)/,
    'Each lane must have independent single-flight protection');
  assert.match(source,/dispatch\\('events',/, 'AI lane must dispatch independently');
  assert.match(source,/dispatch\\('reminders',/, 'Follow-up lane must dispatch independently');
  assert.match(source,/dispatch\\('reports',/, 'Reporting lane must dispatch independently');
  assert.match(source,/Promise\\.allSettled\\(\\[\\.\\.\\.inFlight\\.values\\(\\)\\]\\)/,
    'Shutdown must drain every active lane');
  assert.match(source,/recordWorkerHeartbeat\(succeeded\)/,
    'Operational heartbeat must not be discarded');
  assert.match(source,/await pool\.end\(\)/,'Graceful shutdown must close the database pool');
}
test('worker bootstrap retains only orchestration, not domain SQL',()=>{
  assertWorkerBootstrapBoundary(worker);
  assert.match(heartbeat,/INSERT INTO worker_health/);
});
test('architecture guard rejects a future domain query in the worker',()=>{
  assert.throws(()=>assertWorkerBootstrapBoundary(worker+"\nawait pool.query('DELETE FROM tasks')"),
    /Worker startup must not contain SQL queries|Worker bootstrap cannot mutate/);
});
