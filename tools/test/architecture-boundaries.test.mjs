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
  assert.match(source,/inFlight\.has\(lane\)/,
    'Each lane must have independent single-flight protection');
  assert.match(source,/dispatch\('events',/, 'AI lane must dispatch independently');
  assert.match(source,/dispatch\('reminders',/, 'Follow-up lane must dispatch independently');
  assert.match(source,/dispatch\('reports',/, 'Reporting lane must dispatch independently');
  assert.match(source,/Promise\.allSettled\(\[\.\.\.inFlight\.values\(\)\]\)/,
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

test('tenant structure read model keeps SQL and authz out of HTTP route',()=>{
  const route=readFileSync(new URL('../../apps/api/src/governance-routes.ts',import.meta.url),'utf8');
  const service=readFileSync(new URL('../../packages/core/src/governance/structure-query.ts',import.meta.url),'utf8');
  const start=route.indexOf("app.get('/tenants/:tenantId/structure'");
  const end=route.indexOf("app.post('/tenants/:tenantId/departments'",start);
  assert.ok(start>=0&&end>start,'Organization structure route exists');
  const block=route.slice(start,end);
  assert.match(block,/return getTenantStructure\(tenantId,await authenticated\(req\)\)/);
  assert.doesNotMatch(block,/pool\.query|SELECT|FROM project_members|FROM tenant_members/,
    'Structure HTTP route must not perform domain SQL or a stale authz check');
  assert.match(service,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(service,/FOR SHARE/,'Authorization must lock current membership');
  assert.match(service,/JOIN project_members pm/,'Non-admin project visibility is explicit');
});

test('project classification commands cannot bypass core tenant governance handler',()=>{
  const route=readFileSync(new URL('../../apps/api/src/governance-routes.ts',import.meta.url),'utf8');
  const command=readFileSync(new URL('../../packages/core/src/governance/classification-command.ts',import.meta.url),'utf8');
  const start=route.indexOf("app.patch('/tenants/:tenantId/projects/:projectId/classification'");
  const end=route.indexOf("app.get('/tenants/:tenantId/members'",start);
  assert.ok(start>=0&&end>start);
  const block=route.slice(start,end);
  assert.match(block,/changeProjectClassification\(tenantId,user,projectId,v\)/);
  assert.doesNotMatch(block,/db\.query|pool\.query|UPDATE projects|DELETE FROM project_departments/,
    'Classification HTTP route must not directly mutate domain tables');
  assert.match(command,/organizationCommand\(tenantId,actorId,'project\.classification_changed'/);
  assert.match(command,/classification_revision=classification_revision\+1/);
  assert.match(command,/DELETE FROM project_departments/);
});

test('AI publication transactions fence all outbox claims and never prelease slow batches',()=>{
  const runner=readFileSync(new URL('../../packages/core/src/conversation/ai-event-runner.ts',import.meta.url),'utf8');
  const clarification=readFileSync(new URL('../../packages/core/src/clarification.ts',import.meta.url),'utf8');
  const outbox=readFileSync(new URL('../../packages/core/src/outbox.ts',import.meta.url),'utf8');
  assert.match(outbox,/export async function assertEventClaim/);
  assert.match(outbox,/claim_token=\$3/);
  assert.match(outbox,/FOR UPDATE/);
  assert.match(runner,/claimEvents\(1\)/,'Claim only the next event to be consumed');
  assert.doesNotMatch(runner,/const events=await claimEvents\(\)/,
    'Never prelease a batch whose later AI calls could expire');
  assert.ok((runner.match(/await assertEventClaim\(db,event\)/g)||[]).length>=3,
    'AI run state, reply and proposals must all be publication-fenced');
  assert.ok((clarification.match(/await assertEventClaim\(db,event\)/g)||[]).length>=3,
    'Each clarification persistence branch must be publication-fenced');
});
