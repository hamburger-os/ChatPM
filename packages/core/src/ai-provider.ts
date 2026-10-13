import { pool } from './db.ts';
import { z } from 'zod';
import { readLLMSettings, callStructuredLLM, modelAuditIdentity } from './llm-transport.ts';

export const PROMPT_VERSION='candidate-v2';
export const CLARIFICATION_PROMPT_VERSION='clarification-v1';

const proposal=z.object({
  kind:z.enum(['task','risk']),
  title:z.string().trim().min(1).max(250),
  detail:z.string().max(5000),
  assignee_hint:z.string().max(100).nullable(),
  due_at:z.string().datetime({offset:true}).nullable(),
  confidence:z.number().min(0).max(1),
});
const candidates=z.object({items:z.array(proposal).max(4)});
const clarification=z.object({
  assignee_hint:z.string().max(100).nullable(),
  due_at:z.string().datetime({offset:true}).nullable(),
  confidence:z.number().min(0).max(1),
});
export type Candidate=z.infer<typeof proposal>;
export type Clarification=z.infer<typeof clarification>;
export type ModelResult<T>={value:T;modelName:string;promptVersion:string};
export class DailyAIBudgetExceeded extends Error {
  constructor(){super('Daily AI budget exceeded');this.name='DailyAIBudgetExceeded';}
}

export interface LLMProvider{
  extractCandidates(project:string,message:string):Promise<ModelResult<Candidate[]>>;
  clarify(project:string,title:string,message:string):Promise<ModelResult<Clarification>>;
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

export class ConfiguredLLMProvider implements LLMProvider{
  constructor(private readonly projectId:string){}
  private async request<T>(input:string,schema:object,output:z.ZodType<T>,promptVersion:string):Promise<ModelResult<T>>{
    const settings=readLLMSettings();
    await reserveCall(this.projectId);
    const data=await callStructuredLLM(settings,input,schema);
    return {value:output.parse(data),modelName:modelAuditIdentity(settings),promptVersion};
  }

  async extractCandidates(project:string,message:string){
    const schema={
      type:'object',additionalProperties:false,required:['items'],
      properties:{items:{
        type:'array',maxItems:4,items:{type:'object',additionalProperties:false,
          required:['kind','title','detail','assignee_hint','due_at','confidence'],
          properties:{
            kind:{type:'string',enum:['task','risk']},title:{type:'string'},
            detail:{type:'string'},assignee_hint:{type:['string','null']},
            due_at:{type:['string','null']},confidence:{type:'number'},
          }},
      }},
    };
    const result=await this.request('项目：'+project+'。仅分析以下消息：\n'+message,schema,candidates,PROMPT_VERSION);
    return {...result,value:result.value.items};
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
      '\n下面是明确引用该候选的项目成员回复。只提取回复中明确给出的负责人称呼和带时区截止时间；未提供或不能确定则为 null，不得猜测：\n'+message,
      schema,clarification,CLARIFICATION_PROMPT_VERSION,
    );
  }
}
