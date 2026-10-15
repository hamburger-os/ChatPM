import { serverConfig } from '../../../packages/core/src/config.ts';
import { callStructuredLLM, modelAuditIdentity } from '../../../packages/core/src/llm-transport.ts';
import { resolveProjectModel } from '../../../packages/core/src/project-model.ts';
import { assertProject, canProject, isSystemAdmin, type ProjectRole } from '../../../packages/core/src/permissions.ts';
import { registerAdminModelRoutes } from './admin-model-routes.ts';
import { registerGovernanceRoutes } from './governance-routes.ts';
import { registerPmRoutes } from './pm-routes.ts';
import { registerEvidenceRoutes } from './evidence-routes.ts';
import { registerTaskRoutes } from './task-routes.ts';
import { registerApprovalRoutes } from './approval-routes.ts';
import { randomUUID } from 'node:crypto';
import { signedQuotaKey } from '../../../packages/core/src/quota-key.ts';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { pool, transaction, audit } from '../../../packages/core/src/db.ts';
import { lockProjectAccess } from '../../../packages/core/src/identity/project-access.ts';
import { createSession, hashPassword, readSession, revokeSession, verifyPassword } from '../../../packages/core/src/security.ts';
import { isValidTimezone } from '../../../packages/core/src/policy.ts';
import { syncFollowup } from '../../../packages/core/src/followup.ts';
import { insertMessage } from '../../../packages/core/src/messages.ts';
import { generateReport } from '../../../packages/core/src/reports.ts';
import { deadEvents, outboxSummary } from '../../../packages/core/src/outbox.ts';

const port = serverConfig.API_PORT;
const origin = serverConfig.WEB_ORIGIN;
const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(10000);
const app = Fastify({ logger: true, bodyLimit: 128 * 1024 });

class ApiError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
const fail = (code:number,msg:string):never => { throw new ApiError(code,msg); };

await app.register(cors, { origin, credentials: true });
await app.register(cookie);
await app.register(helmet);
// Verify signed session identity before choosing a quota bucket. Never trust raw
// cookies or X-Forwarded-For; anonymous requests remain IP-scoped.
await app.register(rateLimit,{
  max:180,timeWindow:'1 minute',
  keyGenerator: req=>signedQuotaKey(req,serverConfig.SESSION_SECRET),
});

app.addHook('onRequest', async (req) => {
  if (['POST','PATCH','PUT','DELETE'].includes(req.method) && req.headers.cookie) {
    if (req.headers.origin !== origin) fail(403,'Origin verification failed');
  }
});
app.setErrorHandler((err, _req, reply) => {
  const error=err as Error & {statusCode?:number,code?:string};
  let code=error.statusCode||500;
  if (err instanceof ZodError) code=400;
  if (error.code==='23505'||error.code==='23503') code=409;
  if (['MODEL_NOT_FOUND','PROVIDER_NOT_FOUND'].includes(error.message)) code=404;
  if (/^MODEL_(?:INVALID_URL|INVALID_MODEL|INVALID_STYLE|KEY_REQUIRED|DEFAULT_UNAVAILABLE|REASONING_UNSUPPORTED|REASONING_STYLE_MISMATCH)$/.test(error.message))
    code=400;
  if (code>=500) app.log.error(err);
  const message=code>=500?'Internal server error':
    error.code==='23505'?'记录已存在或名称重复':
    error.code==='23503'?'数据仍被使用或关联关系无效':error.message;
  reply.code(code).send({error:message});
});

async function authenticated(req: { cookies: Record<string,string|undefined>, headers: {authorization?:string} }) {
  const token = req.cookies.chatpm_session ??
    req.headers.authorization?.replace(/^Bearer\s+/i,'');
  const user = token ? await readSession(token) : null;
  if (!user) fail(401,'请先登录');
  return user!;
}
async function member(userId:string, projectId:string) {
  const {rows}=await pool.query(
    `SELECT pm.role,p.tenant_id,p.ai_enabled,p.timezone,p.work_start,p.work_end,p.cooldown_hours
     FROM project_members pm JOIN projects p ON p.id=pm.project_id
     JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
     WHERE pm.project_id=$1 AND pm.user_id=$2`,[projectId,userId]);
  if (!rows[0]) fail(404,'项目不存在或无权限');
  return rows[0] as {role:ProjectRole,tenant_id:string,ai_enabled:boolean,
    timezone:string,work_start:number|null,work_end:number|null,cooldown_hours:number|null};
}
function owner(m:{role:string}) {
  assertProject(m.role as ProjectRole,'members.manage');
}
async function issueSession(reply:{setCookie:Function},userId:string) {
  reply.setCookie('chatpm_session',await createSession(userId),{
    path:'/',httpOnly:true,secure:new URL(serverConfig.WEB_ORIGIN).protocol==='https:',
    sameSite:'lax',maxAge:7*86400,
  });
}

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return {ok:true};
});
app.post('/auth/register', {config:{rateLimit:{max:5,timeWindow:'1 minute'}}}, async (req,reply) => {
  const input=z.object({email:z.string().email().max(200).transform(x=>x.toLowerCase()),
    displayName:z.string().trim().min(1).max(80),password:z.string().min(10).max(128)}).parse(req.body);
  const user=await transaction(async db=>{
    const u=(await db.query(
      'INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id,email,display_name',
      [input.email,input.displayName,hashPassword(input.password)])).rows[0];
    const tenant=(await db.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',
      [input.displayName+' 的团队'])).rows[0];
    await db.query('INSERT INTO tenant_members(tenant_id,user_id,role) VALUES($1,$2,$3)',
      [tenant.id,u.id,'admin']);
    return u;
  });
  await issueSession(reply,user.id);
  return {user};
});
app.post('/auth/login', {config:{rateLimit:{max:8,timeWindow:'1 minute'}}}, async(req,reply)=>{
  const input=z.object({email:z.string().email().transform(x=>x.toLowerCase()),
    password:z.string().min(1)}).parse(req.body);
  const user=(await pool.query(
    'SELECT id,email,display_name,password_hash FROM users WHERE email=$1',[input.email])).rows[0];
  if (!user || !verifyPassword(input.password,user.password_hash)) fail(401,'账号或密码错误');
  await issueSession(reply,user.id);
  return {user:{id:user.id,email:user.email,display_name:user.display_name}};
});
app.post('/auth/logout',async(req,reply)=>{
  const token=req.cookies.chatpm_session ?? req.headers.authorization?.replace(/^Bearer\s+/i,'');
  if(token) await revokeSession(token);
  reply.clearCookie('chatpm_session',{path:'/'});
  return {ok:true};
});
app.get('/me',async req=>{
  const userId=await authenticated(req);
  const {rows}=await pool.query('SELECT id,email,display_name FROM users WHERE id=$1',[userId]);
  return {user:{...rows[0],is_system_admin:await isSystemAdmin(userId)}};
});

app.get('/tenants',async req=>{
  const userId=await authenticated(req);
  const {rows}=await pool.query(`SELECT t.id,t.name,tm.role FROM tenants t
    JOIN tenant_members tm ON tm.tenant_id=t.id WHERE tm.user_id=$1
    ORDER BY t.name,t.id`,[userId]);
  return {tenants:rows};
});
app.get('/projects',async req=>{
  const userId=await authenticated(req);
  const {rows}=await pool.query(
    `SELECT p.id,p.name,p.timezone,p.ai_enabled,p.work_start,p.work_end,p.cooldown_hours,pm.role
     FROM projects p JOIN project_members pm ON pm.project_id=p.id
     JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
     WHERE pm.user_id=$1 ORDER BY p.created_at DESC`,[userId]);
  return {projects:rows};
});
app.post('/projects',async(req,reply)=>{
  const userId=await authenticated(req);
  const input=z.object({name:z.string().trim().min(1).max(140),
    tenantId:uuid,timezone:z.string().default('Asia/Shanghai')}).parse(req.body);
  if (!isValidTimezone(input.timezone)) fail(400,'不支持的时区');
  const project=await transaction(async db=>{
    const ten=(await db.query(
      `SELECT tenant_id FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 AND role='admin'`,
      [input.tenantId,userId])).rows[0];
    if(!ten) fail(403,'没有创建项目权限');
    const row=(await db.query(
      'INSERT INTO projects(tenant_id,name,owner_id,timezone) VALUES($1,$2,$3,$4) RETURNING id,tenant_id,name,timezone,ai_enabled,work_start,work_end,cooldown_hours',
      [ten.tenant_id,input.name,userId,input.timezone])).rows[0];
    await db.query('INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,$3)',
      [row.id,userId,'owner']);
    await audit(db,row.id,userId,'project.created',row.id);
    return row;
  });
  return reply.code(201).send({project});
});
app.get('/projects/:id',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  await member(userId,projectId);
  const {rows}=await pool.query(
    `SELECT id,name,timezone,ai_enabled,work_start,work_end,cooldown_hours FROM projects WHERE id=$1`,
    [projectId]);
  return {project:rows[0]};
});
app.get('/projects/:id/members',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  await member(userId,projectId);
  const {rows}=await pool.query(
    `SELECT u.id,u.display_name,u.email,pm.role FROM project_members pm
     JOIN users u ON u.id=pm.user_id WHERE pm.project_id=$1 ORDER BY u.display_name`,
    [projectId]);
  return {members:rows};
});
app.post('/projects/:id/members',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  const {email}=z.object({email:z.string().email().transform(v=>v.toLowerCase())}).parse(req.body);
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,userId);
    assertProject(access.role,'members.manage');
    const person=(await db.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];
    if (!person) fail(404,'该邮箱尚未注册');
    const existing=await db.query(
      'SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 FOR SHARE',
      [access.tenantId,person.id]);
    if(!existing.rowCount)fail(403,'请先由组织管理员将人员加入该组织');
    await db.query(
      `INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'member')
       ON CONFLICT DO NOTHING`,[projectId,person.id]);
    await audit(db,projectId,userId,'project.member_added',person.id);
    return {ok:true};
  });
});
app.patch('/projects/:id/members/:memberId',async req=>{
  const {id,memberId}=req.params as {id:string;memberId:string};
  const projectId=uuid.parse(id),target=uuid.parse(memberId);
  const actor=await authenticated(req);
  const {role}=z.object({role:z.enum(['manager','member','observer'])}).parse(req.body);
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,actor);
    assertProject(access.role,'members.manage');
    const existing=await db.query(`SELECT role FROM project_members
      WHERE project_id=$1 AND user_id=$2 FOR UPDATE`,[projectId,target]);
    if(!existing.rowCount || existing.rows[0].role==='owner')fail(403,'不能修改项目负责人的角色');
    if(role==='observer'){
      const assigned=await db.query(`SELECT 1 FROM tasks WHERE project_id=$1 AND assignee_id=$2
        AND status NOT IN ('done','cancelled') LIMIT 1`,[projectId,target]);
      if(assigned.rowCount)fail(409,'该人员仍有未完成任务，请先移交任务');
    }
    await db.query('UPDATE project_members SET role=$3 WHERE project_id=$1 AND user_id=$2',
      [projectId,target,role]);
    await audit(db,projectId,actor,'project.member_role_changed',target,{role});
    return {ok:true};
  });
});
app.delete('/projects/:id/members/:memberId',async req=>{
  const {id,memberId}=req.params as {id:string;memberId:string};
  const projectId=uuid.parse(id),target=uuid.parse(memberId);
  const actor=await authenticated(req);
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,actor);
    assertProject(access.role,'members.manage');
    // Authorize before self-removal validation; members must get 403, not a
    // misleading owner-only rule or an authorization oracle.
    if(actor===target) fail(400,'不能通过此接口移除项目负责人');
    // Serialize revocation with task creation/assignment using the member row lock.
    const found=await db.query(`SELECT 1 FROM project_members
      WHERE project_id=$1 AND user_id=$2 AND role='member' FOR UPDATE`,
      [projectId,target]);
    if(!found.rowCount) fail(404,'项目成员不存在');
    const assigned=await db.query(`SELECT 1 FROM tasks
      WHERE project_id=$1 AND assignee_id=$2 AND status NOT IN ('done','cancelled')
      LIMIT 1`,[projectId,target]);
    if(assigned.rowCount) fail(409,'该成员仍有未完成任务，请先重新指派或取消任务');
    await db.query(`DELETE FROM project_members
      WHERE project_id=$1 AND user_id=$2 AND role='member'`,[projectId,target]);
    await audit(db,projectId,actor,'project.member_removed',target);
    return {ok:true};
  });
});
app.patch('/projects/:id/settings',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  const v=z.object({aiEnabled:z.boolean(),workStart:z.number().int().min(0).max(23).nullable(),
    workEnd:z.number().int().min(1).max(24).nullable(),
    cooldownHours:z.number().int().min(1).max(168).nullable()}).parse(req.body);
  const none=v.workStart===null && v.workEnd===null && v.cooldownHours===null;
  if(!none && (v.workStart===null||v.workEnd===null||v.cooldownHours===null ||
    v.workStart>=v.workEnd)) fail(400,'提醒策略必须完整配置');
  if(v.aiEnabled) {
    try { await resolveProjectModel(projectId); }
    catch { fail(400,'服务器尚未正确配置 AI 模型'); }
  }
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,userId);
    assertProject(access.role,'settings.manage');
    await db.query(
      `UPDATE projects SET ai_enabled=$1,work_start=$2,work_end=$3,cooldown_hours=$4 WHERE id=$5`,
      [v.aiEnabled,v.workStart,v.workEnd,v.cooldownHours,projectId]);
    const ts=await db.query('SELECT id FROM tasks WHERE project_id=$1',[projectId]);
    for(const t of ts.rows) await syncFollowup(db,projectId,t.id);
    await audit(db,projectId,userId,'project.settings_changed',projectId,
      {aiEnabled:v.aiEnabled,hasReminderPolicy:!none});
    return {ok:true};
  });
});
app.get('/projects/:id/ai/authorization',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  owner(await member(await authenticated(req),id));
  const {rows}=await pool.query(`SELECT ai_enabled AS enabled,
    ai_authorization_version AS version FROM projects WHERE id=$1`,[id]);
  return {authorization:{enabled:rows[0].enabled,version:Number(rows[0].version)}};
});
app.get('/projects/:id/ai/invocations',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  owner(await member(await authenticated(req),id));
  const {rows}=await pool.query(`SELECT id,authorization_version,model_identity,
    prompt_version,status,error_code,latency_ms,input_tokens,output_tokens,
    started_at,finished_at
    FROM ai_model_invocations WHERE project_id=$1 ORDER BY started_at DESC LIMIT 60`,[id]);
  return {invocations:rows};
});

app.get('/projects/:id/ai/runs',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  owner(await member(await authenticated(req),id));
  const {rows}=await pool.query(`SELECT source_message_id,kind,status,model_name,error_code,
      created_at,updated_at FROM ai_analysis_runs WHERE project_id=$1
      ORDER BY created_at DESC LIMIT 40`,[id]);
  return {runs:rows};
});

app.get('/projects/:id/messages',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  await member(await authenticated(req),projectId);
  const query=z.object({after:z.coerce.number().int().min(0).default(0)}).parse(req.query);
  const recent=query.after===0;
  const sql=recent
    ? `SELECT * FROM (SELECT m.id,m.seq,m.kind,m.content,m.client_nonce,m.created_at,m.author_id,
       u.display_name AS author FROM messages m LEFT JOIN users u ON u.id=m.author_id
       WHERE m.project_id=$1 ORDER BY m.seq DESC LIMIT 200) recent ORDER BY recent.seq ASC`
    : `SELECT m.id,m.seq,m.kind,m.content,m.client_nonce,m.created_at,m.author_id,u.display_name AS author
       FROM messages m LEFT JOIN users u ON u.id=m.author_id
       WHERE m.project_id=$1 AND m.seq>$2 ORDER BY m.seq ASC LIMIT 200`;
  const {rows}=await pool.query(sql,recent?[projectId]:[projectId,query.after]);
  return {messages:rows};
});
app.post('/projects/:id/messages',async(req,reply)=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  assertProject((await member(userId,projectId)).role,'message.write');
  const {content,nonce}=z.object({content:text,nonce:z.string().uuid()}).parse(req.body);
  const message=await transaction(async db=>{
    let row=await insertMessage(db,{
      projectId,authorId:userId,kind:'user',content,nonce,
    });
    if(!row) {
      row=(await db.query('SELECT * FROM messages WHERE project_id=$1 AND client_nonce=$2',
        [projectId,nonce])).rows[0];
      if(!row || row.author_id!==userId || row.content!==content) fail(409,'消息幂等键冲突');
    } else {
      await db.query(
        `INSERT INTO outbox_events(project_id,kind,message_id) VALUES($1,'message.created',$2)`,
        [projectId,row.id]);
    }
    return row;
  });
  return reply.code(201).send({message});
});
app.get('/projects/:id/tasks',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  await member(await authenticated(req),projectId);
  const {rows}=await pool.query(
    `SELECT t.*,t.due_date::text AS due_date,u.display_name AS assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=$1 ORDER BY t.created_at DESC LIMIT 300`,[projectId]);
  return {tasks:rows};
});
app.get('/projects/:id/progress',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  await member(await authenticated(req),id);
  const {rows}=await pool.query(`SELECT u.id,u.task_id,u.source_message_id,
    u.summary,u.kind,u.status,u.created_at,t.title AS task_title
    FROM task_progress_updates u JOIN tasks t ON t.id=u.task_id AND t.project_id=u.project_id
    WHERE u.project_id=$1 ORDER BY u.created_at DESC LIMIT 150`,[id]);
  return {updates:rows};
});
app.get('/projects/:id/proposals',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  await member(await authenticated(req),projectId);
  const {rows}=await pool.query(
    `SELECT pc.*, ct.assignee_hint AS clarified_assignee_hint,
       ct.due_at AS clarified_due_at,ct.status AS clarification_status,
       ct.response_message_id AS clarification_message_id
     FROM proposed_changes pc LEFT JOIN clarification_threads ct ON ct.proposal_id=pc.id
     WHERE pc.project_id=$1 ORDER BY pc.created_at DESC LIMIT 200`,
    [projectId]);
  return {proposals:rows};
});
app.get('/projects/:id/outbox/summary',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  owner(await member(await authenticated(req),projectId));
  return {summary:await outboxSummary(projectId)};
});
app.get('/projects/:id/outbox/dead',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  owner(await member(userId,projectId));
  return {events:await deadEvents(projectId)};
});
app.post('/projects/:id/outbox/:eventId/retry',async req=>{
  const {id,eventId}=req.params as {id:string,eventId:string};
  const projectId=uuid.parse(id),event=uuid.parse(eventId);
  const userId=await authenticated(req);
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,userId);
    assertProject(access.role,'operations.manage');
    const {rows}=await db.query(
      `UPDATE outbox_events SET attempts=0,dead_at=NULL,last_error_code=NULL,
       claimed_at=NULL,claim_token=NULL,next_attempt_at=NOW()
       WHERE id=$1 AND project_id=$2 AND dead_at IS NOT NULL AND processed_at IS NULL
       RETURNING id`,[event,projectId]);
    if(!rows.length)fail(409,'事件未隔离或不属于当前项目');
    await audit(db,projectId,userId,'outbox.retried',event);
    return {ok:true};
  });
});
app.get('/projects/:id/risks',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  await member(await authenticated(req),projectId);
  return {risks:(await pool.query('SELECT * FROM risks WHERE project_id=$1 ORDER BY created_at DESC',[projectId])).rows};
});
app.get('/projects/:id/reports',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  await member(await authenticated(req),projectId);
  return {reports:(await pool.query('SELECT * FROM reports WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50',[projectId])).rows};
});
app.post('/projects/:id/reports',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  const {kind}=z.object({kind:z.enum(['week','month'])}).parse(req.body);
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,userId);
    assertProject(access.role,'report.manage');
    const report=await generateReport(db,projectId,kind,userId);
    await audit(db,projectId,userId,'report.generated',report.id,{kind});
    return {report};
  });
});
app.post('/projects/:id/reports/:reportId/publish',async req=>{
  const {id,reportId}=req.params as {id:string,reportId:string};
  const projectId=uuid.parse(id),report=uuid.parse(reportId);
  const userId=await authenticated(req);
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,userId);
    assertProject(access.role,'report.manage');
    const x=await db.query(
      `UPDATE reports SET state='published' WHERE id=$1 AND project_id=$2 RETURNING id`,
      [report,projectId]);
    if(!x.rowCount) fail(404,'报告不存在');
    await audit(db,projectId,userId,'report.published',report);
    return {ok:true};
  });
});

registerAdminModelRoutes(app,authenticated);
registerGovernanceRoutes(app,authenticated);
registerPmRoutes(app,authenticated);
registerEvidenceRoutes(app,authenticated);
registerTaskRoutes(app,authenticated);
registerApprovalRoutes(app,authenticated);
app.addHook('onClose',async()=>{await pool.end();});
await app.listen({port,host:serverConfig.API_HOST});
