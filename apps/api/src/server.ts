import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { pool, transaction, audit, type DbClient } from '../../../packages/core/src/db.ts';
import { createSession, hashPassword, readSession, verifyPassword } from '../../../packages/core/src/security.ts';
import { isValidTimezone } from '../../../packages/core/src/policy.ts';
import { syncFollowup } from '../../../packages/core/src/followup.ts';
import { generateReport } from '../../../packages/core/src/reports.ts';

const port = Number(process.env.API_PORT ?? '3001');
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
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
await app.register(rateLimit,{max:100,timeWindow:'1 minute'});

app.addHook('onRequest', async (req) => {
  if (['POST','PATCH','PUT','DELETE'].includes(req.method) && req.headers.cookie) {
    if (req.headers.origin !== origin) fail(403,'Origin verification failed');
  }
});
app.setErrorHandler((err, _req, reply) => {
  const error=err as Error & {statusCode?:number,code?:string};
  let code=error.statusCode||500;
  if (err instanceof ZodError) code=400;
  if (error.code==='23505') code=409;
  if (code>=500) app.log.error(err);
  reply.code(code).send({error:code>=500?'Internal server error':error.message});
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
     WHERE pm.project_id=$1 AND pm.user_id=$2`,[projectId,userId]);
  if (!rows[0]) fail(404,'项目不存在或无权限');
  return rows[0] as {role:'owner'|'member',tenant_id:string,ai_enabled:boolean,
    timezone:string,work_start:number|null,work_end:number|null,cooldown_hours:number|null};
}
function owner(m:{role:string}) {
  if (m.role !== 'owner') fail(403,'仅项目负责人可以执行此操作');
}
async function issueSession(reply:{setCookie:Function},userId:string) {
  reply.setCookie('chatpm_session',await createSession(userId),{
    path:'/',httpOnly:true,secure:process.env.NODE_ENV==='production',
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
app.post('/auth/logout',async(_req,reply)=>{
  reply.clearCookie('chatpm_session',{path:'/'});
  return {ok:true};
});
app.get('/me',async req=>{
  const userId=await authenticated(req);
  const {rows}=await pool.query('SELECT id,email,display_name FROM users WHERE id=$1',[userId]);
  return {user:rows[0]};
});

app.get('/projects',async req=>{
  const userId=await authenticated(req);
  const {rows}=await pool.query(
    `SELECT p.id,p.name,p.timezone,p.ai_enabled,pm.role
     FROM projects p JOIN project_members pm ON pm.project_id=p.id
     WHERE pm.user_id=$1 ORDER BY p.created_at DESC`,[userId]);
  return {projects:rows};
});
app.post('/projects',async(req,reply)=>{
  const userId=await authenticated(req);
  const input=z.object({name:z.string().trim().min(1).max(140),
    timezone:z.string().default('Asia/Shanghai')}).parse(req.body);
  if (!isValidTimezone(input.timezone)) fail(400,'不支持的时区');
  const project=await transaction(async db=>{
    const ten=(await db.query(
      `SELECT tenant_id FROM tenant_members WHERE user_id=$1 AND role='admin' ORDER BY tenant_id LIMIT 1`,
      [userId])).rows[0];
    if(!ten) fail(403,'没有创建项目权限');
    const row=(await db.query(
      'INSERT INTO projects(tenant_id,name,owner_id,timezone) VALUES($1,$2,$3,$4) RETURNING *',
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
  const m=await member(userId,projectId);owner(m);
  const {email}=z.object({email:z.string().email().transform(v=>v.toLowerCase())}).parse(req.body);
  return transaction(async db=>{
    const person=(await db.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];
    if (!person) fail(404,'该邮箱尚未注册');
    await db.query(
      `INSERT INTO tenant_members(tenant_id,user_id,role) VALUES($1,$2,'member')
       ON CONFLICT DO NOTHING`,[m.tenant_id,person.id]);
    await db.query(
      `INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'member')
       ON CONFLICT DO NOTHING`,[projectId,person.id]);
    await audit(db,projectId,userId,'project.member_added',person.id);
    return {ok:true};
  });
});
app.patch('/projects/:id/settings',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  owner(await member(userId,projectId));
  const v=z.object({aiEnabled:z.boolean(),workStart:z.number().int().min(0).max(23).nullable(),
    workEnd:z.number().int().min(1).max(24).nullable(),
    cooldownHours:z.number().int().min(1).max(168).nullable()}).parse(req.body);
  const none=v.workStart===null && v.workEnd===null && v.cooldownHours===null;
  if(!none && (v.workStart===null||v.workEnd===null||v.cooldownHours===null ||
    v.workStart>=v.workEnd)) fail(400,'提醒策略必须完整配置');
  if(v.aiEnabled && !process.env.OPENAI_API_KEY) fail(400,'服务器尚未配置 AI 模型');
  return transaction(async db=>{
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
app.get('/projects/:id/messages',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  await member(await authenticated(req),projectId);
  const query=z.object({after:z.coerce.number().int().min(0).default(0)}).parse(req.query);
  const {rows}=await pool.query(
    `SELECT m.id,m.seq,m.kind,m.content,m.created_at,m.author_id,u.display_name AS author
     FROM messages m LEFT JOIN users u ON u.id=m.author_id
     WHERE m.project_id=$1 AND m.seq>$2 ORDER BY m.seq ASC LIMIT 200`,
    [projectId,query.after]);
  return {messages:rows};
});
app.post('/projects/:id/messages',async(req,reply)=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  await member(userId,projectId);
  const {content,nonce}=z.object({content:text,nonce:z.string().uuid()}).parse(req.body);
  const message=await transaction(async db=>{
    const result=await db.query(
      `INSERT INTO messages(project_id,author_id,kind,content,client_nonce)
       VALUES($1,$2,'user',$3,$4) ON CONFLICT(project_id,client_nonce) DO NOTHING RETURNING *`,
      [projectId,userId,content,nonce]);
    let row=result.rows[0];
    if(!row) {
      row=(await db.query('SELECT * FROM messages WHERE project_id=$1 AND client_nonce=$2',
        [projectId,nonce])).rows[0];
      if(row.author_id!==userId || row.content!==content) fail(409,'消息幂等键冲突');
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
    `SELECT t.*,u.display_name AS assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=$1 ORDER BY t.created_at DESC LIMIT 300`,[projectId]);
  return {tasks:rows};
});
app.post('/projects/:id/tasks',async(req,reply)=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const userId=await authenticated(req);
  owner(await member(userId,projectId));
  const v=z.object({title:z.string().trim().min(1).max(250),detail:z.string().max(5000).default(''),
    assigneeId:uuid.nullable().default(null),dueAt:z.string().datetime({offset:true}).nullable().default(null)}).parse(req.body);
  const row=await transaction(async db=>{
    if(v.assigneeId) await ensureAssignee(db,projectId,v.assigneeId);
    const task=(await db.query(
      `INSERT INTO tasks(project_id,title,detail,assignee_id,due_at)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [projectId,v.title,v.detail,v.assigneeId,v.dueAt])).rows[0];
    await syncFollowup(db,projectId,task.id);
    await audit(db,projectId,userId,'task.created',task.id);
    return task;
  });
  return reply.code(201).send({task:row});
});
async function ensureAssignee(db: DbClient, projectId:string,userId:string) {
  const r=await db.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2',
    [projectId,userId]);
  if (!r.rowCount) fail(400,'负责人不属于本项目');
}
app.patch('/projects/:id/tasks/:taskId',async req=>{
  const p=req.params as {id:string,taskId:string};
  const projectId=uuid.parse(p.id),taskId=uuid.parse(p.taskId);
  const userId=await authenticated(req);
  const m=await member(userId,projectId);
  const v=z.object({version:z.number().int().positive(),
    status:z.enum(['todo','doing','blocked','done','cancelled'])}).parse(req.body);
  return transaction(async db=>{
    const row=(await db.query('SELECT * FROM tasks WHERE id=$1 AND project_id=$2 FOR UPDATE',
      [taskId,projectId])).rows[0];
    if(!row) fail(404,'任务不存在');
    if(m.role!=='owner' && row.assignee_id!==userId) fail(403,'只有负责人或被指派者可更新状态');
    if(row.version!==v.version) fail(409,'任务版本已更新，请刷新');
    const t=(await db.query(
      `UPDATE tasks SET status=$1,version=version+1,updated_at=NOW()
       WHERE id=$2 AND project_id=$3 RETURNING *`,
      [v.status,taskId,projectId])).rows[0];
    await syncFollowup(db,projectId,taskId);
    await audit(db,projectId,userId,'task.status_changed',taskId,
      {from:row.status,to:v.status,version:t.version});
    return {task:t};
  });
});
app.get('/projects/:id/proposals',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  await member(await authenticated(req),projectId);
  const {rows}=await pool.query(
    `SELECT * FROM proposed_changes WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [projectId]);
  return {proposals:rows};
});
app.post('/projects/:id/proposals/:proposalId/decision',async req=>{
  const {id,proposalId}=req.params as {id:string,proposalId:string};
  const projectId=uuid.parse(id),candidate=uuid.parse(proposalId);
  const userId=await authenticated(req);
  owner(await member(userId,projectId));
  const v=z.object({decision:z.enum(['accepted','rejected']),
    assigneeId:uuid.nullable().default(null)}).parse(req.body);
  return transaction(async db=>{
    const p=(await db.query(
      `SELECT * FROM proposed_changes WHERE id=$1 AND project_id=$2 FOR UPDATE`,
      [candidate,projectId])).rows[0];
    if(!p) fail(404,'待确认事项不存在');
    if(p.status!=='pending') fail(409,'该事项已经处理');
    if(v.assigneeId) await ensureAssignee(db,projectId,v.assigneeId);
    if(v.decision==='accepted') {
      if(p.kind==='task') {
        const t=(await db.query(
          `INSERT INTO tasks(project_id,title,detail,assignee_id,due_at,source_proposal_id)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [projectId,p.title,p.detail,v.assigneeId,p.due_at,p.id])).rows[0];
        await syncFollowup(db,projectId,t.id);
      } else {
        await db.query(
          `INSERT INTO risks(project_id,title,detail,source_proposal_id)
           VALUES($1,$2,$3,$4)`,[projectId,p.title,p.detail,p.id]);
      }
    }
    await db.query(
      'UPDATE proposed_changes SET status=$1,approved_by=$2 WHERE id=$3',
      [v.decision,userId,candidate]);
    await audit(db,projectId,userId,'proposal.'+v.decision,candidate);
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
  owner(await member(userId,projectId));
  const {kind}=z.object({kind:z.enum(['week','month'])}).parse(req.body);
  return transaction(async db=>{
    const report=await generateReport(db,projectId,kind,userId);
    await audit(db,projectId,userId,'report.generated',report.id,{kind});
    return {report};
  });
});
app.post('/projects/:id/reports/:reportId/publish',async req=>{
  const {id,reportId}=req.params as {id:string,reportId:string};
  const projectId=uuid.parse(id),report=uuid.parse(reportId);
  const userId=await authenticated(req);
  owner(await member(userId,projectId));
  return transaction(async db=>{
    const x=await db.query(
      `UPDATE reports SET state='published' WHERE id=$1 AND project_id=$2 RETURNING id`,
      [report,projectId]);
    if(!x.rowCount) fail(404,'报告不存在');
    await audit(db,projectId,userId,'report.published',report);
    return {ok:true};
  });
});

app.addHook('onClose',async()=>{await pool.end();});
await app.listen({port,host:'0.0.0.0'});
