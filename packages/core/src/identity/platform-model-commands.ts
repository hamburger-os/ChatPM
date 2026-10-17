import {z} from 'zod';
import {systemAdminTransaction} from './system-access.ts';
import type {DbClient} from '../db.ts';
import {
  deleteModelConfig,deleteProvider,importModelConfigs,resolveModelConfig,
  saveModelConfig,saveProvider,
} from '../project-model.ts';

// One authoritative input contract for platform model ADMIN commands. Parse
// inside systemAdminTransaction: a revoked/non-admin actor must see 403 even
// if the untrusted HTTP body is malformed.
const uuid=z.string().uuid();
const providerInput=z.object({
  name:z.string().trim().min(1).max(100),
  baseUrl:z.string().url().max(2048),
  style:z.enum(['responses','chat-completions']),
  enabled:z.boolean(),
  apiKey:z.string().min(1).max(5000).regex(/^[^\r\n]+$/).optional(),
}).strict();
const modelInput=z.object({
  name:z.string().trim().min(1).max(100),
  model:z.string().trim().min(1).max(150),
  providerId:uuid,
  reasoning:z.enum(['auto','none','low','medium','high','max']),
  reasoningFormat:z.enum(['none','responses-effort','chat-completions-effort']),
  maxOutputTokens:z.number().int().min(512).max(131072),
  contextChars:z.number().int().min(2000).max(250000),
  enabled:z.boolean(),isDefault:z.boolean(),
}).strict();
const importInput=z.object({
  providerId:uuid,
  models:z.array(z.object({
    id:z.string().trim().min(1).max(150).regex(/^[^\r\n]+$/),
    name:z.string().trim().min(1).max(100).optional(),
  }).strict()).min(1).max(50),
}).strict();
const testInput=z.object({mode:z.enum(['quick','full']).default('quick')}).strict();

function denied(code:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode:code});
}
async function audit(
  db:DbClient,actorId:string,action:string,targetId:string,
  metadata?:Record<string,unknown>,
):Promise<void>{
  if(metadata===undefined){
    await db.query(`
      INSERT INTO system_audit_entries(actor_id,action,target_id)
      VALUES($1,$2,$3)
    `,[actorId,action,targetId]);
  }else{
    await db.query(`
      INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
      VALUES($1,$2,$3,$4)
    `,[actorId,action,targetId,JSON.stringify(metadata)]);
  }
}

/** Every command owns one current platform-admin grant, mutation and audit
 * transaction. HTTP is a DTO/transport boundary, never the business owner.
 */
export function createPlatformProvider(actorId:string,raw:unknown){
  return systemAdminTransaction(actorId,async db=>{
    const value=providerInput.parse(raw);
    const saved=await saveProvider(db,null,value);
    await audit(db,actorId,'ai.provider_created',saved.id,
      {name:saved.name,style:saved.style});
    return saved;
  });
}
export function updatePlatformProvider(actorId:string,id:string,raw:unknown){
  return systemAdminTransaction(actorId,async db=>{
    const value=providerInput.parse(raw);
    const saved=await saveProvider(db,id,value);
    await audit(db,actorId,'ai.provider_updated',id,{
      name:saved.name,style:saved.style,enabled:saved.enabled,
      secretChanged:Boolean(value.apiKey),
    });
    return saved;
  });
}
export function deletePlatformProvider(actorId:string,id:string){
  return systemAdminTransaction(actorId,async db=>{
    const related=await db.query(`
      SELECT 1 FROM ai_model_configs WHERE provider_id=$1 LIMIT 1
    `,[id]);
    if(related.rowCount)denied(409,'请先移除该供应商的模型');
    const removed=await deleteProvider(db,id);
    if(!removed)denied(404,'供应商不存在');
    await audit(db,actorId,'ai.provider_deleted',id);
    return {ok:true};
  });
}
export function importPlatformModels(actorId:string,raw:unknown){
  return systemAdminTransaction(actorId,async db=>{
    const value=importInput.parse(raw);
    const imported=await importModelConfigs(db,value.providerId,value.models);
    await audit(db,actorId,'ai.models_imported',value.providerId,{
      ...imported,count:value.models.length,
    });
    return imported;
  });
}
export function createPlatformModel(actorId:string,raw:unknown){
  return systemAdminTransaction(actorId,async db=>{
    const value=modelInput.parse(raw);
    const saved=await saveModelConfig(db,null,value);
    await audit(db,actorId,'ai.model_created',saved.id,{
      name:saved.name,model:saved.model,providerId:saved.providerId,
    });
    return saved;
  });
}
export function updatePlatformModel(actorId:string,id:string,raw:unknown){
  return systemAdminTransaction(actorId,async db=>{
    const value=modelInput.parse(raw);
    const saved=await saveModelConfig(db,id,value);
    await audit(db,actorId,'ai.model_updated',id,{
      model:saved.model,providerId:saved.providerId,
      enabled:saved.enabled,isDefault:saved.isDefault,
    });
    return saved;
  });
}
export function deletePlatformModel(actorId:string,id:string){
  return systemAdminTransaction(actorId,async db=>{
    const removed=await deleteModelConfig(db,id);
    if(!removed)denied(404,'模型不存在');
    await audit(db,actorId,'ai.model_deleted',id);
    return {ok:true};
  });
}

/** Prepare an already-authorized, rate-controlled *single* network call.
 * Do not hold the admin row lock or DB transaction during external HTTP.
 */
export function preparePlatformModelTest(actorId:string,id:string,raw:unknown){
  return systemAdminTransaction(actorId,async db=>{
    const {mode}=testInput.parse(raw??{});
    const config=await resolveModelConfig(id,true,db)
      .catch(()=>denied(400,'模型配置不可用'));
    const check=await db.query(`
      INSERT INTO ai_model_checks(model_config_id,last_test_at)
      VALUES($1,NOW()) ON CONFLICT(model_config_id) DO UPDATE SET
      last_test_at=NOW() WHERE ai_model_checks.last_test_at<NOW()-INTERVAL '30 seconds'
      RETURNING model_config_id
    `,[id]);
    if(!check.rowCount)denied(429,
      '每个模型最多每 30 秒测试一次，以避免误触发计费调用');
    return {config,mode};
  });
}
