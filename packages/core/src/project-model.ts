import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pool, type DbClient } from './db.ts';
import { readLLMSettings, type LLMSettings, type LLMApiStyle } from './llm-transport.ts';

type Reasoning='auto'|'none'|'low'|'medium'|'high'|'max';
export type ModelInput={
  name:string; model:string; baseUrl:string; style:LLMApiStyle;
  reasoning:Reasoning; maxOutputTokens:number; contextChars:number;
  enabled:boolean; isDefault:boolean; apiKey?:string;
};
export type ModelPublic=Omit<ModelInput,'apiKey'> & {id:string;hasKey:boolean};
type ModelRow={
  id:string;name:string;model_id:string;base_url:string;api_style:LLMApiStyle;
  api_key_ciphertext:string|null;reasoning:Reasoning;max_output_tokens:number;
  context_chars:number;enabled:boolean;is_default:boolean;
};

// Different rotation lifecycle from the login session signing secret.
function key(){
  const secret=process.env.MODEL_ENCRYPTION_KEY;
  if(!secret || secret.length<32)throw new Error('MODEL_ENCRYPTION_NOT_CONFIGURED');
  return createHash('sha256').update('chatpm:model-secret:v2:').update(secret).digest();
}
export function encryptModelKey(value:string):string{
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(),nonce);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
}
export function decryptModelKey(value:string):string{
  try{
    const data=Buffer.from(value,'base64');
    if(data.length<29)throw new Error('invalid');
    const cipher=createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));
    cipher.setAuthTag(data.subarray(12,28));
    return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8');
  }catch{throw new Error('MODEL_KEY_DECRYPTION_FAILED');}
}

export function validateModelUrl(value:string):string{
  let url:URL;
  try{url=new URL(value);}catch{throw new Error('MODEL_INVALID_URL');}
  const hostname=url.hostname.toLowerCase();
  const local=['localhost','127.0.0.1','[::1]','host.docker.internal'].includes(hostname);
  if(url.username||url.password||url.search||url.hash||url.origin==='null'||
     value.length>2048||/\r|\n/.test(value)||
     !(url.protocol==='https:'||(url.protocol==='http:'&&local))||
     (!local && (hostname.endsWith('.local')||hostname.endsWith('.internal')||
       /^(?:10|127|169\.254|192\.168)\./.test(hostname)||hostname==='0.0.0.0')))
    throw new Error('MODEL_INVALID_URL');
  const prefix=url.pathname.replace(/\/+$/,'');
  if(/\/(responses|chat\/completions)$/.test(prefix))throw new Error('MODEL_INVALID_URL');
  return url.origin+prefix;
}
function asPublic(r:ModelRow):ModelPublic{
  return {id:r.id,name:r.name,model:r.model_id,baseUrl:r.base_url,
    style:r.api_style,reasoning:r.reasoning,maxOutputTokens:r.max_output_tokens,
    contextChars:r.context_chars,enabled:r.enabled,isDefault:r.is_default,
    hasKey:Boolean(r.api_key_ciphertext)};
}
export async function listModelConfigs():Promise<ModelPublic[]>{
  const {rows}=await pool.query<ModelRow>('SELECT * FROM ai_model_configs ORDER BY is_default DESC,name');
  return rows.map(asPublic);
}
export async function saveModelConfig(db:DbClient,id:string|null,value:ModelInput):Promise<ModelPublic>{
  const url=validateModelUrl(value.baseUrl);
  // There may be only one default; serialize across all administrators.
  await db.query('SELECT pg_advisory_xact_lock(21844,7302)');
  const existing=id?(await db.query<ModelRow>(
    'SELECT * FROM ai_model_configs WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
  if(id&&!existing)throw new Error('MODEL_NOT_FOUND');
  const cipher=value.apiKey?encryptModelKey(value.apiKey):existing?.api_key_ciphertext??null;
  if(value.enabled&&!cipher)throw new Error('MODEL_KEY_REQUIRED');
  if(value.isDefault && !value.enabled)throw new Error('MODEL_DEFAULT_MUST_BE_ENABLED');
  if(value.isDefault)await db.query('UPDATE ai_model_configs SET is_default=FALSE WHERE is_default=TRUE');
  const fields=[value.name,value.model,url,value.style,cipher,value.reasoning,
    value.maxOutputTokens,value.contextChars,value.enabled,value.isDefault];
  const {rows}=id
    ?await db.query<ModelRow>(`UPDATE ai_model_configs SET
       name=$1,model_id=$2,base_url=$3,api_style=$4,api_key_ciphertext=$5,
       reasoning=$6,max_output_tokens=$7,context_chars=$8,enabled=$9,
       is_default=$10,updated_at=NOW() WHERE id=$11 RETURNING *`,[...fields,id])
    :await db.query<ModelRow>(`INSERT INTO ai_model_configs
       (name,model_id,base_url,api_style,api_key_ciphertext,reasoning,
        max_output_tokens,context_chars,enabled,is_default)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,fields);
  return asPublic(rows[0]);
}
export async function deleteModelConfig(db:DbClient,id:string):Promise<boolean>{
  const {rowCount}=await db.query('DELETE FROM ai_model_configs WHERE id=$1',[id]);
  return Boolean(rowCount);
}
export async function resolveModelConfig(id?:string):Promise<LLMSettings>{
  const {rows}=await pool.query<ModelRow>(id
    ?'SELECT * FROM ai_model_configs WHERE id=$1'
    :'SELECT * FROM ai_model_configs WHERE enabled=TRUE AND is_default=TRUE',
    id?[id]:[]);
  const model=rows[0];
  if(!model || (!id && !model.enabled))throw new Error('MODEL_NOT_CONFIGURED');
  if(!model.api_key_ciphertext)throw new Error('MODEL_NOT_CONFIGURED');
  const config=readLLMSettings({
    LLM_API_KEY:decryptModelKey(model.api_key_ciphertext),
    LLM_BASE_URL:validateModelUrl(model.base_url),
    LLM_MODEL:model.model_id,LLM_API_STYLE:model.api_style,
  });
  return {...config,reasoning:model.reasoning,maxOutputTokens:model.max_output_tokens,
    contextChars:model.context_chars};
}
// Project scope remains explicit; all projects use the platform-managed default.
export async function resolveProjectModel(projectId:string):Promise<LLMSettings>{
  const found=await pool.query('SELECT 1 FROM projects WHERE id=$1',[projectId]);
  if(!found.rowCount)throw new Error('PROJECT_NOT_FOUND');
  return resolveModelConfig();
}
