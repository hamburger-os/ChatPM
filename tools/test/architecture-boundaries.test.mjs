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
  assert.match(outbox,/export async function renewEventLease/);
  assert.match(outbox,/export async function withEventLeaseHeartbeat/);
  assert.match(outbox,/OUTBOX_LEASE_SECONDS=300/);
  assert.match(runner,/withEventLeaseHeartbeat\(event,\(\)=>runAnalysis\(event\)\)/,
    'Slow model inference must renew only its current Outbox claim');
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
  const end=api.indexOf("app.get('/projects/:id/progress'",start);
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

test('formal PM read models use the sole Core membership snapshot',()=>{
  const api=readFileSync(new URL('../../apps/api/src/pm-routes.ts',import.meta.url),'utf8');
  const query=readFileSync(new URL('../../packages/core/src/governance/pm-register-query.ts',import.meta.url),'utf8');
  const projectRoute=readFileSync(new URL('../../apps/api/src/project-routes.ts',import.meta.url),'utf8');
  const projectQuery=readFileSync(new URL('../../packages/core/src/project-queries.ts',import.meta.url),'utf8');
  const access=readFileSync(new URL('../../packages/core/src/identity/project-access.ts',import.meta.url),'utf8');

  for(const [opening,closing,method] of [
    ["app.get('/projects/:projectId/pm'","app.post('/projects/:projectId/pm/:kind'","listPmRegisters"],
    ["app.get('/projects/:projectId/pm/issues/:itemId/history'","const decisionSchema","readPmIssueHistory"],
    ["app.get('/projects/:projectId/pm/changes/:itemId/implementation/history'","const dependencySchema","readPmChangeImplementationHistory"],
    ["app.get('/projects/:projectId/pm/dependencies'","app.post('/projects/:projectId/pm/dependencies'","listPmTaskDependencies"],
  ]){
    const start=api.indexOf(opening);
    const end=api.indexOf(closing,start);
    assert.ok(start>=0&&end>start,'Expected PM GET route '+opening);
    const route=api.slice(start,end);
    assert.ok(route.includes(method+'('),'PM GET must delegate to Core '+method);
    assert.doesNotMatch(route,/pool\.query|db\.query|\bSELECT\b|\bFROM\b/i);
  }
  assert.equal((query.match(/withProjectRead\(/g)||[]).length,4);
  assert.match(access,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(access,/lockProjectAccess\(db,projectId,actorId\)/);
  assert.match(query,/issue_version<COALESCE\(\$3::int,2147483647\)/);
  assert.match(query,/change_version<COALESCE\(\$3::int,2147483647\)/);
  assert.match(api,/max\(2147483647\)/);
  const getStart=projectRoute.indexOf("app.get('/projects'");
  const postStart=projectRoute.indexOf("app.post('/projects'",getStart);
  assert.ok(getStart>=0&&postStart>getStart);
  const navigation=projectRoute.slice(getStart,postStart);
  assert.match(navigation,/listMemberProjects\(await authenticated\(req\)\)/);
  assert.doesNotMatch(navigation,/pool\.query|\bSELECT\b/i);
  assert.match(projectQuery,/JOIN tenant_members tm/);
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
  const governance=readFileSync(new URL('../../packages/core/src/identity/project-governance.ts',import.meta.url),'utf8');
  const model=readFileSync(new URL('../../packages/core/src/project-model.ts',import.meta.url),'utf8');
  assert.match(routes,/updateProjectSettings\(projectId,actor,input\)/);
  assert.doesNotMatch(routes,/resolveProjectModel|executePmCommand|db\.query/);
  assert.match(governance,/resolveProjectModel\(projectId,db\)/);
  assert.match(model,/resolveModelConfig\(undefined,false,db\)/);
  assert.match(model,/await db\.query<EffectiveRow>/);
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
  const query=readFileSync(new URL('../../packages/core/src/delivery/task-queries.ts',import.meta.url),'utf8');
  assert.match(query,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(query,/lockProjectAccess\(db,projectId,actorId\)/);
  assert.match(route,/listProjectTasks\(projectId,actorId/);
  assert.match(route,/setTaskArchived\(projectId,taskId,actorId/);
  assert.doesNotMatch(route,/UPDATE tasks|DELETE FROM tasks|executePmCommand\(/,
    'Archive HTTP route must never own the official Task write');
  assert.match(core,/kind:archive\?'task\.archived\.v1':'task\.restored\.v1'/);
  assert.match(core,/executePmCommand\(/);
  assert.match(core,/before\.archived_at\)fail\(409/);
  assert.match(core,/task_progress_updates/);
  assert.match(history,/CREATE OR REPLACE FUNCTION capture_project_task_history/);
  assert.match(history,/before_archived_at,after_archived_at/);
  assert.match(history,/BEFORE INSERT ON task_progress_updates/);
  assert.match(history,/FOR SHARE/);

  assert.match(runner,/!p\.archived_at/);
  assert.match(ai,/archived_at IS NULL/);
});

test('Outbox operations routes delegate secured reads and retry to Core',()=>{
  const route=readFileSync(new URL('../../apps/api/src/operations-routes.ts',import.meta.url),'utf8');
  const core=readFileSync(new URL('../../packages/core/src/operations/outbox-admin.ts',import.meta.url),'utf8');
  assert.match(route,/readOutboxSummary\(projectId,actorId\)/);
  assert.match(route,/readDeadEvents\(projectId,actorId\)/);
  assert.match(route,/retryDeadEvent\(projectId,eventId,actorId,body\.parse\(req\.body\)\)/);
  assert.doesNotMatch(route,/\b(?:SELECT|UPDATE|INSERT INTO|DELETE FROM|pool\.query|executePmCommand)\b/i);
  assert.match(core,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(core,/lockProjectAccess\(db,projectId,actorId\)/);
  assert.match(core,/assertProject\(access\.role,'operations\.manage'\)/);
  assert.match(core,/outboxSummary\(projectId,db\)/);
  assert.match(core,/deadEvents\(projectId,db\)/);
  assert.match(core,/executePmCommand\(/);
});

test('Reporting API delegates reads and report command state to Core',()=>{
  const route=readFileSync(new URL('../../apps/api/src/report-routes.ts',import.meta.url),'utf8');
  const service=readFileSync(new URL('../../packages/core/src/reporting/report-services.ts',import.meta.url),'utf8');
  for(const symbol of ['listProjectReports','requestProjectReport','publishProjectReport'])
    assert.match(route,new RegExp('\\b'+symbol+'\\('));
  assert.doesNotMatch(route,/\b(?:SELECT|UPDATE|INSERT INTO|DELETE FROM)\b|pool\.query|executePmCommand\(/i,
    'Report HTTP must never own state mutation or business SQL');
  assert.match(service,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(service,/lockProjectAccess\(db,projectId,actorId\)/);
  assert.match(service,/await generateReport\(db,projectId,v\.kind,actorId\)/);
  assert.match(service,/report\.published\.v1/);
  assert.equal((service.match(/executePmCommand\(\{/g)||[]).length,2,
    'Both report mutations must reuse the same durable receipt runtime');
});

test('Conversation cursor and SSE stream use one current-membership read service',()=>{
  const api=readFileSync(new URL('../../apps/api/src/server.ts',import.meta.url),'utf8');
  const stream=readFileSync(new URL('../../apps/api/src/message-stream-routes.ts',import.meta.url),'utf8');
  const query=readFileSync(new URL('../../packages/core/src/conversation/message-queries.ts',import.meta.url),'utf8');
  const proxy=readFileSync(new URL('../../apps/web/app/api/[...path]/route.ts',import.meta.url),'utf8');
  const page=readFileSync(new URL('../../apps/web/app/page.tsx',import.meta.url),'utf8');
  assert.match(api,/return listProjectMessages\(projectId,actorId,query\)/);
  assert.match(query,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(query,/lockProjectAccess\(db,projectId,actorId\)/);
  assert.match(query,/ORDER BY m\.seq/);
  assert.match(stream,/req\.headers\['last-event-id'\]/);
  assert.match(stream,/await authenticated\(req\)/);
  assert.match(stream,/await listProjectMessages\(projectId,actorId/);
  assert.match(stream,/after=Number\(m\.seq\)/);
  assert.match(stream,/reply\.raw\.once\('close',cleanup\)/);
  assert.match(stream,/reply\.raw\.once\('drain',done\)/);
  assert.match(proxy,/eventStream \? response\.body : await response\.arrayBuffer\(\)/);
  assert.match(proxy,/signal: eventStream \? request\.signal : AbortSignal\.timeout\(30000\)/);
  assert.match(proxy,/'last-event-id'/);
  assert.match(page,/new EventSource\('/);
  assert.match(page,/setHistoryMore\(page\.hasMore\)/);
});

test('project AI and review reads cannot split API authorization from domain SQL',()=>{
  const api=readFileSync(new URL('../../apps/api/src/server.ts',import.meta.url),'utf8');
  const access=readFileSync(new URL('../../packages/core/src/identity/project-access.ts',import.meta.url),'utf8');
  const project=readFileSync(new URL('../../packages/core/src/project-queries.ts',import.meta.url),'utf8');
  const review=readFileSync(new URL('../../packages/core/src/approval/review-queries.ts',import.meta.url),'utf8');
  const start=api.indexOf("app.get('/projects/:id',");
  const end=api.indexOf('registerInvitationRoutes(',start);
  assert.ok(start>=0&&end>start);
  const routes=api.slice(start,end);
  for(const name of ['getProjectDetails','getProjectAiAuthorization',
    'listProjectAiInvocations','listProjectAiRuns',
    'listProjectProgress','listProjectProposals'])
    assert.ok(routes.includes(name+'('),'Route must delegate to '+name);
  assert.doesNotMatch(routes,/\b(?:SELECT|INSERT|UPDATE|DELETE)\b|pool\.query|\bmember\(/i);
  assert.match(access,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(access,/lockProjectAccess\(db,projectId,actorId\)/);
  assert.match(access,/assertProject\(access\.role,action\)/);
  assert.equal((project.match(/withProjectRead\(/g)||[]).length,4);
  assert.equal((review.match(/withProjectRead\(/g)||[]).length,2);
  assert.equal((project.match(/'ai\.audit\.read'/g)||[]).length,3);
});

test('all formal PM mutations stay in the single Core command owner',()=>{
  const api=readFileSync(new URL('../../apps/api/src/pm-routes.ts',import.meta.url),'utf8');
  const core=readFileSync(new URL('../../packages/core/src/governance/pm-register-commands.ts',import.meta.url),'utf8');
  const commands=[
    'createPmEntry','reassignPmDeliverable','submitPmDeliverable',
    'reviewPmDeliverable','transitionPmIssue','decidePmChange',
    'updatePmChangeImplementation','createPmTaskDependency',
  ];
  for(const command of commands){
    assert.ok(api.includes(command+'('),'API must delegate '+command);
    assert.ok(core.includes('export function '+command+'('),'Core must own '+command);
  }
  assert.doesNotMatch(api,/executePmCommand\(|\b(?:INSERT INTO|UPDATE|DELETE FROM|SELECT)\b|db\.query\s*\(/i,
    'PM route must never mutate domain tables or create separate receipts');
  assert.doesNotMatch(api,/lockTaskDependencyGraph|type PmMutation|type DbClient/);
  assert.equal((core.match(/return executePmCommand\(/g)||[]).length,8);
  assert.match(core,/lockTaskDependencyGraph\(db,projectId\)/);
  assert.match(core,/project_issue_transitions/);
  assert.match(core,/project_change_implementation_history/);
  assert.match(core,/assertProject\(role,'pm.submit',\{isAssignee:true\}\)/);
  assert.match(core,/input\.decision==='complete'\?'pm.accept':'pm.plan'/);
  assert.match(core,/projectId,actorId:user,idempotencyKey:input\.idempotencyKey/);
});

test('project membership and settings endpoints are pure DTO delegation',()=>{
  const api=readFileSync(new URL('../../apps/api/src/project-governance-routes.ts',import.meta.url),'utf8');
  const core=readFileSync(new URL('../../packages/core/src/identity/project-governance.ts',import.meta.url),'utf8');
  const methods=['listProjectMembers','addProjectMember','changeProjectMemberRole',
    'removeProjectMember','transferProjectOwnership','updateProjectSettings'];
  for(const name of methods){
    assert.ok(api.includes(name+'('),'HTTP must delegate '+name);
    assert.match(core,new RegExp('export (?:async )?function '+name+'\\('),'Identity Core owns '+name);
  }
  assert.doesNotMatch(api,/\bSELECT\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+|\bDELETE\s+FROM\b|(?:pool|db)\.query\s*\(|executePmCommand\s*\(/i);
  assert.equal((core.match(/return executePmCommand\(/g)||[]).length,5);
  assert.equal((core.match(/await assertNoActiveResponsibilities\(db,projectId,target,/g)||[]).length,2);
  assert.match(core,/return withProjectRead\(projectId,actorId,'read'/);
  assert.match(core,/FOR UPDATE/);
  assert.match(core,/replayAction:'read'/);
  assert.match(core,/ownership_revision=ownership_revision\+1/);
  assert.match(core,/project_change_requests/);
  assert.match(core,/resource_allocations/);
  assert.match(core,/syncFollowup\(db,projectId,task\.id\)/);
});
test('tenant resource planning never assigns execution capacity to project observers',()=>{
  const core=readFileSync(new URL('../../packages/core/src/resource-allocation.ts',import.meta.url),'utf8');
  assert.match(core,/pm\.role<>'observer'/);
  assert.match(core,/FOR SHARE OF p,pm,tm/);
  assert.match(core,/资源只能分配给本组织内当前可承担执行责任的项目成员/);
});
