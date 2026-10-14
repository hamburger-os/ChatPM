import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, transaction } from '../../../packages/core/src/db.ts';
import { requireSystemAdmin } from '../../../packages/core/src/permissions.ts';
import {
  deleteModelConfig,deleteProvider,listModelConfigs,listProviders,
  resolveModelConfig,saveModelConfig,saveProvider,
} from '../../../packages/core/src/project-model.ts';
import { callStructuredLLM, modelAuditIdentity } from '../../../packages/core/src/llm-transport.ts';

const uuid=z.string().uuid();
const denied=(code:number,message:string):never=>{
  throw Object.assign(new Error(message),{statusCode:code});
};
const providerSchema=z.object({
  name:z.string().trim().min(1).max(100),
  baseUrl:z.string().url().max(2048),
  style:z.enum(['responses','chat-completions']),
  enabled:z.boolean(),
  apiKey:z.string().min(1).max(5000).regex(/^[^\r\n]+$/).optional(),
}).strict();
const modelSchema=z.object({
  name:z.string().trim().min(1).max(100),
  model:z.string().trim().min(1).max(150),
  providerId:uuid,
  reasoning:z.enum(['auto','none','low','medium','high','max']),
  reasoningFormat:z.enum(['none','responses-effort','chat-completions-effort']),
  maxOutputTokens:z.number().int().min(512).max(131072),
  contextChars:z.number().int().min(2000).max(250000),
  enabled:z.boolean(),isDefault:z.boolean(),
}).strict();

export function registerAdminModelRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  const admin=async(req:FastifyRequest)=>{
    const actor=await authenticated(req);
    await requireSystemAdmin(actor);
    return actor;
  };
  app.get('/admin/ai/providers',async req=>{
    await admin(req);return {providers:await listProviders()};
  });
  app.post('/admin/ai/providers',async(req,reply)=>{
    const actor=await admin(req),value=providerSchema.parse(req.body);
    const provider=await transaction(async db=>{
      const saved=await saveProvider(db,null,value);
      await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
        VALUES($1,'ai.provider_created',$2,$3)`,
        [actor,saved.id,JSON.stringify({name:saved.name,style:saved.style})]);
      return saved;
    });
    return reply.code(201).send({provider});
  });
  app.put('/admin/ai/providers/:id',async req=>{
    const actor=await admin(req),id=uuid.parse((req.params as {id:string}).id);
    const value=providerSchema.parse(req.body);
    const provider=await transaction(async db=>{
      const saved=await saveProvider(db,id,value);
      await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
        VALUES($1,'ai.provider_updated',$2,$3)`,[actor,id,JSON.stringify({
        name:saved.name,style:saved.style,enabled:saved.enabled,secretChanged:Boolean(value.apiKey),
      })]);
      return saved;
    });
    return {provider};
  });
  app.delete('/admin/ai/providers/:id',async req=>{
    const actor=await admin(req),id=uuid.parse((req.params as {id:string}).id);
    const removed=await transaction(async db=>{
      const related=await db.query('SELECT 1 FROM ai_model_configs WHERE provider_id=$1 LIMIT 1',[id]);
      if(related.rowCount)denied(409,'请先移除该供应商的模型');
      const ok=await deleteProvider(db,id);
      if(ok)await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id)
        VALUES($1,'ai.provider_deleted',$2)`,[actor,id]);
      return ok;
    });
    if(!removed)denied(404,'供应商不存在');
    return {ok:true};
  });
  app.get('/admin/ai/models',async req=>{
    await admin(req);return {models:await listModelConfigs()};
  });
  app.post('/admin/ai/models',async(req,reply)=>{
    const actor=await admin(req),value=modelSchema.parse(req.body);
    const model=await transaction(async db=>{
      const saved=await saveModelConfig(db,null,value);
      await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
        VALUES($1,'ai.model_created',$2,$3)`,[actor,saved.id,JSON.stringify({
        name:saved.name,model:saved.model,providerId:saved.providerId})]);
      return saved;
    });
    return reply.code(201).send({model});
  });
  app.put('/admin/ai/models/:id',async req=>{
    const actor=await admin(req),id=uuid.parse((req.params as {id:string}).id);
    const value=modelSchema.parse(req.body);
    const model=await transaction(async db=>{
      const saved=await saveModelConfig(db,id,value);
      await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
        VALUES($1,'ai.model_updated',$2,$3)`,[actor,id,JSON.stringify({
        model:saved.model,providerId:saved.providerId,
        enabled:saved.enabled,isDefault:saved.isDefault})]);
      return saved;
    });
    return {model};
  });
  app.delete('/admin/ai/models/:id',async req=>{
    const actor=await admin(req),id=uuid.parse((req.params as {id:string}).id);
    const deleted=await transaction(async db=>{
      const removed=await deleteModelConfig(db,id);
      if(removed)await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id)
        VALUES($1,'ai.model_deleted',$2)`,[actor,id]);
      return removed;
    });
    if(!deleted)denied(404,'模型不存在');
    return {ok:true};
  });
  app.post('/admin/ai/models/:id/test',async req=>{
    await admin(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const config=await resolveModelConfig(id).catch(()=>denied(400,'模型配置不可用'));
    const check=await pool.query(`INSERT INTO ai_model_checks(model_config_id,last_test_at)
      VALUES($1,NOW()) ON CONFLICT(model_config_id) DO UPDATE SET
      last_test_at=NOW() WHERE ai_model_checks.last_test_at<NOW()-INTERVAL '30 seconds'
      RETURNING model_config_id`,[id]);
    if(!check.rowCount)denied(429,'每个模型最多每 30 秒测试一次');
    const started=Date.now();
    try{
      const result=await callStructuredLLM(config,
        '这是匿名连接测试，不包含真实项目资料。仅返回 JSON 对象 {"ok":true}。',
        {type:'object',additionalProperties:false,required:['ok'],properties:{ok:{type:'boolean'}}});
      if(!result||typeof result!=='object'||(result as {ok?:unknown}).ok!==true)
        throw new Error('MODEL_INVALID_TEST_RESPONSE');
      return {ok:true,latencyMs:Date.now()-started,model:modelAuditIdentity(config)};
    }catch(error){
      const code=error instanceof Error&&/^MODEL_[A-Z0-9_]+$/.test(error.message)
        ?error.message:'MODEL_CONNECTION_FAILED';
      denied(422,'模型测试失败：'+code);
    }
  });
}
