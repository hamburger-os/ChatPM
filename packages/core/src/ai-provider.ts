import { secureModelFetch } from './model-egress.ts';
import { createHmac } from 'node:crypto';
import { pool, type DbClient } from './db.ts';
import { z } from 'zod';
import { callStructuredLLM, modelAuditIdentity } from './llm-transport.ts';
import { resolveProjectModel } from './project-model.ts';

export const PROMPT_VERSION='project-activity-v3';
export const CLARIFICATION_PROMPT_VERSION='clarification-v2';
export const REPLY_PROMPT_VERSION='pm-reply-v1';

const proposal=z.object({
  kind:z.enum(['task','risk']),
  title:z.string().trim().min(1).max(250),
  detail:z.string().max(5000),
  assignee_hint:z.string().max(100).nullable(),
  due_at:z.string().nullable().transform(v=>
    v&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)&&!Number.isNaN(Date.parse(v))
      ? new Date(v).toISOString():null),
  confidence:z.number().min(0).max(1),
});
const progress=z.object({
  task_id:z.string().uuid(),
  kind:z.enum(['progress','blocker','completion_claim']),
  summary:z.string().trim().min(1).max(2000),
});
const activity=z.object({items:z.array(proposal).max(4),
  progress:z.array(progress).max(4)});
export type TaskProgressSuggestion=z.infer<typeof progress>;
export type WorkAnalysis=z.infer<typeof activity>;
export const ACTIVITY_SCHEMA={
      type:'object',additionalProperties:false,required:['items','progress'],
      properties:{
        items:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,
          required:['kind','title','detail','assignee_hint','due_at','confidence'],
          properties:{
            kind:{type:'string',enum:['task','risk']},title:{type:'string'},
            detail:{type:'string'},assignee_hint:{type:['string','null']},
            due_at:{type:['string','null']},confidence:{type:'number'},
          }}},
        progress:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,
          required:['task_id','kind','summary'],
          properties:{task_id:{type:'string'},kind:{type:'string',
            enum:['progress','blocker','completion_claim']},summary:{type:'string'}}}},
      },
    };

export function buildActivityPrompt(project:string,message:string):string{
  return '项目：'+project+'。只分析“当前待分析消息”；优先匹配提供的正式任务 ID，'+
      '如果消息是在描述已有任务的进度、阻塞或声称完成，请在 progress 中写入对应 task_id，'+
      '不要重复在 items 创建它。仅能使用上下文中给出的任务 ID，不得编造。'+
      '只有明确是独立的新工作或新风险才生成 items；不明确时留空。'+
      '关于任务进度的“已完成初稿”不等于正式任务已完成。不得自己批准。\n'+message;
}
export function parseWorkAnalysis(result:unknown):WorkAnalysis{
  return activity.parse(result);
}

const assistantReply=z.object({reply:z.string().trim().min(1).max(1200)});
const clarification=z.object({
  assignee_hint:z.string().max(100).nullable(),
  due_at:z.string().datetime({offset:true}).nullable(),
  confidence:z.number().min(0).max(1),
});
export type Candidate=z.infer<typeof proposal>;
export type Clarification=z.infer<typeof clarification>;
export type ModelResult<T>={value:T;modelName:string;promptVersion:string;authorizationVersion?:number};
export class DailyAIBudgetExceeded extends Error {
  constructor(){super('Daily AI budget exceeded');this.name='DailyAIBudgetExceeded';}
}

export interface LLMProvider{
  analyzeWork(project:string,message:string):Promise<ModelResult<WorkAnalysis>>;
  clarify(project:string,title:string,message:string):Promise<ModelResult<Clarification>>;
  respond(project:string,context:string):Promise<ModelResult<{reply:string}>>;
}

async function reserveCall(projectId:string){
  const limit=Math.max(1,Math.min(500,Number(process.env.AI_DAILY_REQUEST_LIMIT)||50));
  const {rows}=await pool.query(`INSERT INTO ai_daily_usage(project_id,usage_day,requests)
    VALUES($1,(NOW() AT TIME ZONE 'UTC')::date,1)
    ON CONFLICT(project_id,usage_day) DO UPDATE
      SET requests=ai_daily_usage.requests+1 WHERE ai_daily_usage.requests < $2
    RETURNING requests`,[projectId,limit]);
  if(!rows.length)throw new DailyAIBudgetExceeded();
}

export async function readProjectAiAuthorization(projectId:string):Promise<{
  enabled:boolean;version:number;
}>{
  const {rows}=await pool.query<{ai_enabled:boolean;ai_authorization_version:string}>(`
    SELECT ai_enabled,ai_authorization_version FROM projects WHERE id=$1
  `,[projectId]);
  const row=rows[0];
  if(!row)throw new Error('PROJECT_NOT_FOUND');
  return {enabled:row.ai_enabled,version:Number(row.ai_authorization_version)};
}
/** Bind every AI publication to the authorization epoch used for inference.
 * FOR SHARE is held through the caller's transaction so toggle/revoke cannot
 * race with the final write. */
export async function assertCurrentAiGrant(
  db:DbClient,projectId:string,authorizationVersion:number|undefined,
):Promise<void>{
  const row=(await db.query<{ai_enabled:boolean;ai_authorization_version:string}>(`
    SELECT ai_enabled,ai_authorization_version FROM projects
    WHERE id=$1 FOR SHARE`,[projectId])).rows[0];
  if(!row?.ai_enabled)throw new Error('AI_AUTHORIZATION_REVOKED');
  if(!authorizationVersion||Number(row.ai_authorization_version)!==authorizationVersion)
    throw new Error('AI_AUTHORIZATION_CHANGED');
}

function safeErrorCode(error:unknown):string{
  if(error instanceof z.ZodError)return 'MODEL_SCHEMA';
  if(error instanceof Error){
    if(/^MODEL_[A-Z0-9_]+$/.test(error.message))return error.message;
    if(error.name==='AbortError')return 'MODEL_TIMEOUT';
  }
  return 'MODEL_INVOCATION_FAILED';
}

export class ConfiguredLLMProvider implements LLMProvider{
  constructor(private readonly projectId:string){}
  private async request<T>(input:string,schema:object,output:z.ZodType<T>,promptVersion:string,mode:'analysis'|'reply'='analysis'):Promise<ModelResult<T>>{
    const authorization=await readProjectAiAuthorization(this.projectId);
    if(!authorization.enabled)throw new Error('AI_AUTHORIZATION_REVOKED');
    const settings=await resolveProjectModel(this.projectId);
    await reserveCall(this.projectId);
    // Do not send queued work using a revoked or replaced authorization.
    const current=await readProjectAiAuthorization(this.projectId);
    if(!current.enabled)throw new Error('AI_AUTHORIZATION_REVOKED');
    if(current.version!==authorization.version)throw new Error('AI_AUTHORIZATION_CHANGED');

    // Fingerprint is keyed so low-entropy private messages cannot be guessed
    // from a public SHA256 digest. No prompt text/response/key is persisted.
    const fingerprintKey=process.env.MODEL_ENCRYPTION_KEY;
    if(!fingerprintKey)throw new Error('MODEL_ENCRYPTION_NOT_CONFIGURED');
    const fingerprint=createHmac('sha256',fingerprintKey).update(input).digest('hex');
    const modelName=modelAuditIdentity(settings);
    const started=await pool.query<{id:string}>(`
      INSERT INTO ai_model_invocations(project_id,authorization_version,
        model_identity,prompt_version,input_fingerprint)
      VALUES($1,$2,$3,$4,$5) RETURNING id
    `,[this.projectId,current.version,modelName,promptVersion,fingerprint]);
    const invocationId=started.rows[0].id;
    const start=Date.now();
    try{
      const data=await callStructuredLLM(settings,input,schema,secureModelFetch,mode);
      const parsed=output.parse(data);
      await pool.query(`UPDATE ai_model_invocations SET status='succeeded',
        latency_ms=$2,finished_at=NOW() WHERE id=$1`,
        [invocationId,Math.max(0,Date.now()-start)]);
      return {value:parsed,modelName,promptVersion,authorizationVersion:current.version};
    }catch(error){
      await pool.query(`UPDATE ai_model_invocations SET status='failed',
        error_code=$2,latency_ms=$3,finished_at=NOW() WHERE id=$1`,
        [invocationId,safeErrorCode(error),Math.max(0,Date.now()-start)]);
      throw error;
    }
  }

  async analyzeWork(project:string,message:string){
    return this.request(buildActivityPrompt(project,message),ACTIVITY_SCHEMA,activity,PROMPT_VERSION);
  }

  async respond(project:string,context:string){
    const schema={type:'object',additionalProperties:false,required:['reply'],
      properties:{reply:{type:'string'}}};
    return this.request('你是项目协作助手，只根据以下正式项目事实与已给出的消息回答。'+
      '不得假装修改任务、指派人员或完成审批，未知信息明确说明。\n项目：'+project+'\n'+context,
      schema,assistantReply,REPLY_PROMPT_VERSION,'reply');
  }

  async clarify(project:string,title:string,message:string){
    const schema={
      type:'object',additionalProperties:false,
      required:['assignee_hint','due_at','confidence'],
      properties:{
        assignee_hint:{type:['string','null']},
        due_at:{type:['string','null']},
        confidence:{type:'number'},
      },
    };
    return this.request(
      '项目：'+project+'。\n待澄清任务：'+title+
      '\n下面是对此候选的成员回复（可能由唯一近期追问关联，无需显式编号）。只提取明确给出的负责人称呼和带时区、确切年份的截止时间；相对时间、歧义日期或未提供则为 null，不得猜测：\n'+message,
      schema,clarification,CLARIFICATION_PROMPT_VERSION,
    );
  }
}
