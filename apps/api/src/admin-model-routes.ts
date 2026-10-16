import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../../../packages/core/src/db.ts';
import { systemAdminTransaction } from '../../../packages/core/src/identity/system-access.ts';
import { requireSystemAdmin } from '../../../packages/core/src/permissions.ts';
import {
  deleteModelConfig,deleteProvider,importModelConfigs,listModelConfigs,listProviders,
  resolveModelConfig,resolveProviderCatalogConfig,saveModelConfig,saveProvider,
} from '../../../packages/core/src/project-model.ts';
import { discoverProviderModels } from '../../../packages/core/src/model-catalog.ts';
import { callStructuredLLM, modelAuditIdentity, probeModelText } from '../../../packages/core/src/llm-transport.ts';

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
    const provider=await systemAdminTransaction(actor,async db=>{
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
    const provider=await systemAdminTransaction(actor,async db=>{
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
    const removed=await systemAdminTransaction(actor,async db=>{
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

  app.post('/admin/ai/providers/:id/discover',async req=>{
    await admin(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const connection=await resolveProviderCatalogConfig(id);
    // Catalog metadata fetches are admin-only and non-billable. Permit an
    // immediate repeat after completion; UI prevents simultaneous clicks.
    try{return await discoverProviderModels(connection);}
    catch(error){
      const code=error instanceof Error?error.message:'';
      const messages:Record<string,string>={
        MODEL_CATALOG_HTTP_401:'模型目录鉴权失败（401），请检查 API Key',
        MODEL_CATALOG_HTTP_403:'无权访问模型目录（403），请检查密钥权限',
        MODEL_CATALOG_HTTP_404:'模型目录返回 404。ChatPM 会将 /models 拼在基础地址后；请检查是否遗漏 /v1（例如基础地址应以 /v1 结尾），再重试。',
        MODEL_CATALOG_HTTP_405:'模型目录接口不支持 GET（405），可以手动注册模型',
        MODEL_CATALOG_HTTP_429:'服务端限制了请求频率（429），请稍后再试',
        MODEL_CATALOG_DNS_FAILED:'模型地址的 DNS 解析失败',
        MODEL_CATALOG_UNSAFE_ENDPOINT:'模型目录连接到受限网络目标；请检查服务器安全策略',
        MODEL_CATALOG_TOO_LARGE:'模型目录响应超过 512 KB 安全上限',
        MODEL_CATALOG_INVALID_RESPONSE:'服务返回的模型目录不是受支持的 JSON 格式',
        MODEL_CATALOG_NETWORK_ERROR:'模型目录请求超时、重定向或网络连接失败',
      };
      denied(422,messages[code]??'获取模型目录失败，请检查接口兼容性后手动注册');
    }
  });
  app.post('/admin/ai/models/import',async(req,reply)=>{
    const actor=await admin(req);
    const input=z.object({
      providerId:uuid,
      models:z.array(z.object({
        id:z.string().trim().min(1).max(150).regex(/^[^\r\n]+$/),
        name:z.string().trim().min(1).max(100).optional(),
      }).strict()).min(1).max(50),
    }).strict().parse(req.body);
    const result=await systemAdminTransaction(actor,async db=>{
      const imported=await importModelConfigs(db,input.providerId,input.models);
      await db.query(`INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
        VALUES($1,'ai.models_imported',$2,$3)`,[actor,input.providerId,
        JSON.stringify({...imported,count:input.models.length})]);
      return imported;
    });
    return reply.code(201).send(result);
  });

  app.get('/admin/ai/models',async req=>{
    await admin(req);return {models:await listModelConfigs()};
  });
  app.post('/admin/ai/models',async(req,reply)=>{
    const actor=await admin(req),value=modelSchema.parse(req.body);
    const model=await systemAdminTransaction(actor,async db=>{
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
    const model=await systemAdminTransaction(actor,async db=>{
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
    const deleted=await systemAdminTransaction(actor,async db=>{
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
    const mode=z.object({mode:z.enum(['quick','full']).default('quick')})
      .strict().parse(req.body??{}).mode;
    const config=await resolveModelConfig(id,true).catch(()=>denied(400,'模型配置不可用'));
    // Tests invoke a billable model. Preserve the per-model test cooldown.
    const check=await pool.query(`INSERT INTO ai_model_checks(model_config_id,last_test_at)
      VALUES($1,NOW()) ON CONFLICT(model_config_id) DO UPDATE SET
      last_test_at=NOW() WHERE ai_model_checks.last_test_at<NOW()-INTERVAL '30 seconds'
      RETURNING model_config_id`,[id]);
    if(!check.rowCount)denied(429,'每个模型最多每 30 秒测试一次，以避免误触发计费调用');
    const started=Date.now();
    const identity=modelAuditIdentity(config);
    const codeFor=(error:unknown):string=>{
      const value=error instanceof Error?error.message:'';
      return /^MODEL_[A-Z0-9_]+$/.test(value)?value:'MODEL_CONNECTION_FAILED';
    };
    let textLatencyMs:number|undefined;
    if(mode==='full'){
      try{
        await probeModelText(config);
      }catch(error){
        return {ok:false,mode,textOk:false,structuredOk:false,
          errorCode:codeFor(error),latencyMs:Date.now()-started,model:identity};
      }
      textLatencyMs=Date.now()-started;
    }
    try{
      const result=await callStructuredLLM(config,
        '这是匿名结构化输出测试，不包含真实项目资料。仅返回 JSON 对象 {"ok":true}。',
        {type:'object',additionalProperties:false,required:['ok'],properties:{ok:{type:'boolean'}}});
      if(!result||typeof result!=='object'||(result as {ok?:unknown}).ok!==true)
        throw new Error('MODEL_TEST_CONTENT_MISMATCH');
      return {ok:true,mode,textOk:mode==='full'?true:null,structuredOk:true,
        ...(textLatencyMs!==undefined?{textLatencyMs}:{}),
        latencyMs:Date.now()-started,model:identity};
    }catch(error){
      return {ok:false,mode,textOk:mode==='full'?true:null,structuredOk:false,
        errorCode:codeFor(error),
        ...(textLatencyMs!==undefined?{textLatencyMs}:{}),
        latencyMs:Date.now()-started,model:identity};
    }
  });
}
