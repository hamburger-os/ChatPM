import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../../../packages/core/src/db.ts';
import { requireSystemAdmin } from '../../../packages/core/src/permissions.ts';
import { deleteModelConfig, listModelConfigs, resolveModelConfig, saveModelConfig } from
  '../../../packages/core/src/project-model.ts';
import { callStructuredLLM, modelAuditIdentity } from '../../../packages/core/src/llm-transport.ts';

const uuid=z.string().uuid();
const inputSchema=z.object({
  name:z.string().trim().min(1).max(100),
  model:z.string().trim().min(1).max(150),
  baseUrl:z.string().url().max(2048),
  style:z.enum(['responses','chat-completions']),
  reasoning:z.enum(['auto','none','low','medium','high','max']),
  maxOutputTokens:z.number().int().min(512).max(131072),
  contextChars:z.number().int().min(2000).max(250000),
  enabled:z.boolean(),isDefault:z.boolean(),
  apiKey:z.string().min(1).max(500).regex(/^[^\r\n]+$/).optional(),
}).strict();
const denied=(code:number,message:string):never=>{
  throw Object.assign(new Error(message),{statusCode:code});
};
export function registerAdminModelRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  const admin=async(req:FastifyRequest)=>{
    const id=await authenticated(req);
    await requireSystemAdmin(id);
    return id;
  };
  app.get('/admin/ai/models',async req=>{
    await admin(req);return {models:await listModelConfigs()};
  });
  app.post('/admin/ai/models',async(req,reply)=>{
    const actor=await admin(req),v=inputSchema.parse(req.body);
    const model=await transaction(async db=>{
      const saved=await saveModelConfig(db,null,v);
      await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
        VALUES($1,'ai.model_created',$2,$3)`,[actor,saved.id,JSON.stringify({
        name:saved.name,model:saved.model,style:saved.style})]);
      return saved;
    });
    app.log.info({actor,modelId:model.id},'Admin added AI model config');
    return reply.code(201).send({model});
  });
  app.put('/admin/ai/models/:id',async req=>{
    const actor=await admin(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const v=inputSchema.parse(req.body);
    const model=await transaction(async db=>{
      const saved=await saveModelConfig(db,id,v);
      await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
        VALUES($1,'ai.model_updated',$2,$3)`,[actor,id,JSON.stringify({
        model:saved.model,enabled:saved.enabled,isDefault:saved.isDefault})]);
      return saved;
    });
    return {model};
  });
  app.delete('/admin/ai/models/:id',async req=>{
    const actor=await admin(req);
    const id=uuid.parse((req.params as {id:string}).id);
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
