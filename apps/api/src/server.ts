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
import { registerReportRoutes } from './report-routes.ts';
import { registerProjectGovernanceRoutes } from './project-governance-routes.ts';
import { registerOperationsRoutes } from './operations-routes.ts';
import { registerRiskRoutes } from './risk-routes.ts';
import { registerProjectRoutes } from './project-routes.ts';
import { randomUUID } from 'node:crypto';
import { signedQuotaKey } from '../../../packages/core/src/quota-key.ts';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { pool, transaction } from '../../../packages/core/src/db.ts';
import { createSession, hashPassword, readSession, revokeSession, verifyPassword } from '../../../packages/core/src/security.ts';
import { syncFollowup } from '../../../packages/core/src/followup.ts';
import { insertMessage } from '../../../packages/core/src/messages.ts';


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
app.get('/projects/:id',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  await member(userId,projectId);
  const {rows}=await pool.query(
    `SELECT id,name,timezone,ai_enabled,work_start,work_end,cooldown_hours,settings_revision,owner_id,ownership_revision FROM projects WHERE id=$1`,
    [projectId]);
  return {project:rows[0]};
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
registerAdminModelRoutes(app,authenticated);
registerGovernanceRoutes(app,authenticated);
registerPmRoutes(app,authenticated);
registerEvidenceRoutes(app,authenticated);
registerTaskRoutes(app,authenticated);
registerApprovalRoutes(app,authenticated);
registerReportRoutes(app,authenticated);
registerProjectGovernanceRoutes(app,authenticated);
registerOperationsRoutes(app,authenticated);
registerRiskRoutes(app,authenticated);
registerProjectRoutes(app,authenticated);
app.addHook('onClose',async()=>{await pool.end();});
await app.listen({port,host:serverConfig.API_HOST});
