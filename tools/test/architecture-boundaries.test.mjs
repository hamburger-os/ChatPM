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

test('all direct Task mutations flow through core application commands',()=>{
  const route=readFileSync(new URL('../../apps/api/src/task-routes.ts',import.meta.url),'utf8');
  const service=readFileSync(new URL('../../packages/core/src/delivery/task-commands.ts',import.meta.url),'utf8');
  assert.match(route,/createTask\(projectId,actorId,input\)/);
  assert.match(route,/updateTask\(projectId,taskId,actorId,input\)/);
  assert.doesNotMatch(route,/\b(?:INSERT INTO|UPDATE|DELETE FROM) tasks\b/i,
    'Task API route cannot bypass Core business validation and receipts');
  assert.doesNotMatch(route,/executePmCommand\(/,
    'Task command wiring must stay in Core, not the API route');
  assert.match(service,/executePmCommand\(/);
  assert.match(service,/hasTaskChanges\(before,next\)/,
    'Every Task update must verify meaningful state change');
});

test('Risk HTTP endpoints own only DTOs and delegate scoped Core services',()=>{
  const route=readFileSync(new URL('../../apps/api/src/risk-routes.ts',import.meta.url),'utf8');
  const commands=readFileSync(new URL('../../packages/core/src/risk/risk-commands.ts',import.meta.url),'utf8');
  const queries=readFileSync(new URL('../../packages/core/src/risk/risk-queries.ts',import.meta.url),'utf8');
  for(const method of ['listProjectRisks','readRiskHistory','assessRisk','transitionRisk'])
    assert.match(route,new RegExp('\\b'+method+'\\('));
  assert.doesNotMatch(route,/\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i,
    'Risk HTTP must not run domain SQL');
  assert.doesNotMatch(route,/executePmCommand\(/,
    'Risk command receipts and events belong to Core');
  assert.match(commands,/executePmCommand\(/);
  assert.match(commands,/risk_register_changes/);
  assert.match(queries,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(queries,/lockProjectAccess\(/);
});

test('user messages have one Core-owned transaction and authorization boundary',()=>{
  const api=readFileSync(new URL('../../apps/api/src/server.ts',import.meta.url),'utf8');
  const command=readFileSync(new URL('../../packages/core/src/conversation/user-message-command.ts',import.meta.url),'utf8');
  const start=api.indexOf("app.post('/projects/:id/messages'");
  const end=api.indexOf("app.get('/projects/:id/tasks'",start);
  assert.ok(start>=0&&end>start);
  const block=api.slice(start,end);
  assert.match(block,/postUserMessage\(projectId,actorId,content,nonce\)/);
  assert.doesNotMatch(block,/insertMessage\(|INSERT INTO messages|pool\.query|transaction\(/);
  assert.match(command,/transaction\(async db/);
  assert.match(command,/lockProjectAccess\(db,projectId,actorId\)/);
  assert.match(command,/assertProject\(access\.role,'message\.write'\)/);
  assert.match(command,/insertMessage\(db/);
  assert.match(command,/outbox_events/);
});

test('human-approved progress and proposal decisions are owned by Core',()=>{
  const route=readFileSync(new URL('../../apps/api/src/approval-routes.ts',import.meta.url),'utf8');
  const command=readFileSync(new URL('../../packages/core/src/approval/decision-commands.ts',import.meta.url),'utf8');
  const delivery=readFileSync(new URL('../../packages/core/src/delivery/task-commands.ts',import.meta.url),'utf8');
  const risk=readFileSync(new URL('../../packages/core/src/risk/risk-commands.ts',import.meta.url),'utf8');
  assert.match(route,/decideProgress\(projectId,progressId,actorId,v\)/);
  assert.match(route,/decideProposal\(projectId,proposalId,actorId,v\)/);
  assert.doesNotMatch(route,/\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i,
    'Review HTTP routes may validate DTOs but never execute domain SQL');
  assert.doesNotMatch(route,/executePmCommand\(|db\.query|pool\.query/,
    'Review command runtime belongs to Core');
  assert.equal((command.match(/executePmCommand\(\{/g)||[]).length,2);
  assert.match(command,/createTaskRecord\(db,projectId/);
  assert.match(command,/createRiskRecord\(db,projectId/);
  assert.match(delivery,/export async function createTaskRecord/);
  assert.match(risk,/export async function createRiskRecord/);
});

test('formal PM register reads use one authorized database snapshot',()=>{
  const api=readFileSync(new URL('../../apps/api/src/pm-routes.ts',import.meta.url),'utf8');
  const query=readFileSync(new URL('../../packages/core/src/governance/pm-register-query.ts',import.meta.url),'utf8');
  const start=api.indexOf("app.get('/projects/:projectId/pm'");
  const end=api.indexOf("app.post('/projects/:projectId/pm/:kind'",start);
  assert.ok(start>=0&&end>start);
  const block=api.slice(start,end);
  assert.match(block,/listPmRegisters\(projectId,actorId\)/);
  assert.doesNotMatch(block,/pool\.query|SELECT|FROM project_members/);
  assert.match(query,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(query,/lockProjectAccess\(db,projectId,actorId\)/);
});

test('platform AI model mutations reauthorize admin within the business transaction',()=>{
  const route=readFileSync(new URL('../../apps/api/src/admin-model-routes.ts',import.meta.url),'utf8');
  const access=readFileSync(new URL('../../packages/core/src/identity/system-access.ts',import.meta.url),'utf8');
  assert.equal((route.match(/systemAdminTransaction\(actor,async db=>/g)||[]).length,7);
  assert.match(route,/systemAdminTransaction\(actor,db=>db\.query/);
  assert.doesNotMatch(route,/transaction\(async db=>|pool\.query/);
  assert.match(access,/SELECT is_system_admin FROM users WHERE id=\$1 FOR SHARE/);
  assert.match(access,/transaction\(async db/);
});

test('project settings reuses model configuration transaction client',()=>{
  const routes=readFileSync(new URL('../../apps/api/src/project-governance-routes.ts',import.meta.url),'utf8');
  const core=readFileSync(new URL('../../packages/core/src/project-model.ts',import.meta.url),'utf8');
  assert.match(routes,/resolveProjectModel\(projectId,db\)/);
  assert.match(core,/resolveModelConfig\(undefined,false,db\)/);
  assert.match(core,/await db\.query<EffectiveRow>/);
});
test('browser message retry retains the same nonce until success or editing',()=>{
  const page=readFileSync(new URL('../../apps/web/app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/sendIntent\.current=\{projectId:selected,content,nonce\}/);
  assert.match(page,/intent\.content===content/);
  assert.match(page,/body:json\(\{content,nonce\}\)/);
});

test('Task archive uses one Core command and retains immutable factual history',()=>{
  const route=readFileSync(new URL('../../apps/api/src/task-routes.ts',import.meta.url),'utf8');
  const core=readFileSync(new URL('../../packages/core/src/delivery/task-commands.ts',import.meta.url),'utf8');
  const history=readFileSync(new URL('../../packages/core/sql/027_task_archive.sql',import.meta.url),'utf8');
  const runner=readFileSync(new URL('../../packages/core/src/automation/reminder-runner.ts',import.meta.url),'utf8');
  const ai=readFileSync(new URL('../../packages/core/src/conversation/ai-event-runner.ts',import.meta.url),'utf8');
  assert.match(route,/setTaskArchived\(projectId,taskId,actorId/);
  assert.doesNotMatch(route,/UPDATE tasks|DELETE FROM tasks|executePmCommand\(/,
    'Archive HTTP route must never own the official Task write');
  assert.match(core,/kind:archive\?'task\.archived\.v1':'task\.restored\.v1'/);
  assert.match(core,/executePmCommand\(/);
  assert.match(core,/before\.archived_at\)fail\(409/);
  assert.match(core,/task_progress_updates/);
  assert.match(history,/CREATE OR REPLACE FUNCTION capture_project_task_history/);
  assert.match(history,/before_archived_at,after_archived_at/);
  assert.match(runner,/!p\.archived_at/);
  assert.match(ai,/archived_at IS NULL/);
});
