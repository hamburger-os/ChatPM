import { serverConfig } from '../../../packages/core/src/config.ts';
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
import { registerInvitationRoutes } from './invitation-routes.ts';
import { signedQuotaKey } from '../../../packages/core/src/quota-key.ts';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import {pool} from '../../../packages/core/src/db.ts';
import {createSession,readSession,revokeSession} from '../../../packages/core/src/security.ts';
import {getRegistrationStatus,registerAccount,authenticateAccount,
  getAccountProfile,listAccountTenants} from
  '../../../packages/core/src/identity/account-services.ts';
import { postUserMessage } from '../../../packages/core/src/conversation/user-message-command.ts';
import { listProjectMessages } from '../../../packages/core/src/conversation/message-queries.ts';
import { registerMessageStreamRoutes } from './message-stream-routes.ts';
import {getProjectDetails,getProjectAiAuthorization,listProjectAiInvocations,
  listProjectAiRuns} from '../../../packages/core/src/project-queries.ts';
import {listProjectProgress,listProjectProposals} from
  '../../../packages/core/src/approval/review-queries.ts';


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
  max:180,timeWindow:'1 minute',hook:'preHandler',
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
app.get('/auth/registration-policy',async()=>getRegistrationStatus());
app.post('/auth/register', {config:{rateLimit:{max:5,timeWindow:'1 minute'}}}, async (req,reply) => {
  const input=z.object({email:z.string().email().max(200).transform(x=>x.toLowerCase()),
    displayName:z.string().trim().min(1).max(80),password:z.string().min(10).max(128),
    bootstrapToken:z.string().max(256).optional()}).parse(req.body);
  const user=await registerAccount(input);
  await issueSession(reply,user.id);
  return {user};
});
app.post('/auth/login', {config:{rateLimit:{max:8,timeWindow:'1 minute'}}}, async(req,reply)=>{
  const input=z.object({email:z.string().email().transform(x=>x.toLowerCase()),
    password:z.string().min(1)}).parse(req.body);
  const user=await authenticateAccount(input.email,input.password);
  await issueSession(reply,user.id);
  return {user};
});
app.post('/auth/logout',async(req,reply)=>{
  const token=req.cookies.chatpm_session ?? req.headers.authorization?.replace(/^Bearer\s+/i,'');
  if(token) await revokeSession(token);
  reply.clearCookie('chatpm_session',{path:'/'});
  return {ok:true};
});
app.get('/me',async req=>getAccountProfile(await authenticated(req)));

app.get('/tenants',async req=>listAccountTenants(await authenticated(req)));
app.get('/projects/:id',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  return getProjectDetails(id,await authenticated(req));
});
app.get('/projects/:id/ai/authorization',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  return getProjectAiAuthorization(id,await authenticated(req));
});
app.get('/projects/:id/ai/invocations',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  return listProjectAiInvocations(id,await authenticated(req));
});
app.get('/projects/:id/ai/runs',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  return listProjectAiRuns(id,await authenticated(req));
});

app.get('/projects/:id/messages',async req=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const actorId=await authenticated(req);
  const query=z.object({
    after:z.coerce.number().int().min(0).safe().optional(),
    before:z.coerce.number().int().positive().safe().optional(),
  }).refine(v=>v.after===undefined||v.before===undefined,
    {message:'after 与 before 不得同时使用'}).parse(req.query);
  return listProjectMessages(projectId,actorId,query);
});
app.post('/projects/:id/messages',async(req,reply)=>{
  const projectId=uuid.parse((req.params as {id:string}).id);
  const actorId=await authenticated(req);
  const {content,nonce}=z.object({content:text,nonce:z.string().uuid()}).parse(req.body);
  const result=await postUserMessage(projectId,actorId,content,nonce);
  return reply.code(201).send(result);
});
app.get('/projects/:id/progress',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  return listProjectProgress(id,await authenticated(req));
});
app.get('/projects/:id/proposals',async req=>{
  const id=uuid.parse((req.params as {id:string}).id);
  return listProjectProposals(id,await authenticated(req));
});
registerInvitationRoutes(app,authenticated,issueSession);
registerAdminModelRoutes(app,authenticated);
registerGovernanceRoutes(app,authenticated);
registerPmRoutes(app,authenticated);
registerEvidenceRoutes(app,authenticated);
registerTaskRoutes(app,authenticated);
registerMessageStreamRoutes(app,authenticated);
registerApprovalRoutes(app,authenticated);
registerReportRoutes(app,authenticated);
registerProjectGovernanceRoutes(app,authenticated);
registerOperationsRoutes(app,authenticated);
registerRiskRoutes(app,authenticated);
registerProjectRoutes(app,authenticated);
app.addHook('onClose',async()=>{await pool.end();});
await app.listen({port,host:serverConfig.API_HOST});
