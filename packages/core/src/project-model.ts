import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pool, type DbClient } from './db.ts';
import { readLLMSettings, type LLMSettings, type LLMApiStyle, type ReasoningFormat } from './llm-transport.ts';
import { validateModelUrl } from './model-endpoint-policy.ts';

type Reasoning='auto'|'none'|'low'|'medium'|'high'|'max';
export type ProviderInput={
  name:string; baseUrl:string; style:LLMApiStyle; enabled:boolean; apiKey?:string;
};
export type ProviderPublic=Omit<ProviderInput,'apiKey'> & {id:string;hasKey:boolean};
export type ModelInput={
  name:string; model:string; providerId:string;
  reasoning:Reasoning; reasoningFormat:ReasoningFormat;
  maxOutputTokens:number; contextChars:number;
  enabled:boolean; isDefault:boolean;
};
export type ModelPublic=ModelInput & {id:string};
type ProviderRow={
  id:string;name:string;base_url:string;api_style:LLMApiStyle;
  api_key_ciphertext:string|null;enabled:boolean;
};
type ModelRow={
  id:string;name:string;model_id:string;provider_id:string;
  reasoning:Reasoning;reasoning_format:ReasoningFormat;max_output_tokens:number;
  context_chars:number;enabled:boolean;is_default:boolean;
};
type EffectiveRow=ModelRow & {base_url:string;api_style:LLMApiStyle;
  api_key_ciphertext:string|null;provider_enabled:boolean};

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

function providerPublic(r:ProviderRow):ProviderPublic{
  return {id:r.id,name:r.name,baseUrl:r.base_url,style:r.api_style,
    enabled:r.enabled,hasKey:Boolean(r.api_key_ciphertext)};
}
function modelPublic(r:ModelRow):ModelPublic{
  return {id:r.id,name:r.name,model:r.model_id,providerId:r.provider_id,
    reasoning:r.reasoning,reasoningFormat:r.reasoning_format,
    maxOutputTokens:r.max_output_tokens,contextChars:r.context_chars,
    enabled:r.enabled,isDefault:r.is_default};
}
export async function listProviders(db:DbClient):Promise<ProviderPublic[]>{
  const {rows}=await db.query<ProviderRow>(
    'SELECT * FROM ai_provider_connections ORDER BY name');
  return rows.map(providerPublic);
}
export async function listModelConfigs(db:DbClient):Promise<ModelPublic[]>{
  const {rows}=await db.query<ModelRow>(
    'SELECT * FROM ai_model_configs ORDER BY is_default DESC,name');
  return rows.map(modelPublic);
}
export async function saveProvider(db:DbClient,id:string|null,value:ProviderInput):Promise<ProviderPublic>{
  const url=validateModelUrl(value.baseUrl);
  const existing=id?(await db.query<ProviderRow>(
    'SELECT * FROM ai_provider_connections WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
  if(id&&!existing)throw new Error('PROVIDER_NOT_FOUND');
  if(id&&existing&&existing.api_style!==value.style){
    const incompatible=await db.query(`SELECT 1 FROM ai_model_configs
      WHERE provider_id=$1 AND reasoning_format=$2 LIMIT 1`,[id,
        value.style==='responses'?'chat-completions-effort':'responses-effort']);
    if(incompatible.rowCount)throw new Error('MODEL_REASONING_STYLE_MISMATCH');
  }
  const cipher=value.apiKey?encryptModelKey(value.apiKey):existing?.api_key_ciphertext??null;
  if(value.enabled&&!cipher)throw new Error('MODEL_KEY_REQUIRED');
  const fields=[value.name,url,value.style,cipher,value.enabled];
  const {rows}=id
    ?await db.query<ProviderRow>(`UPDATE ai_provider_connections SET name=$1,base_url=$2,
       api_style=$3,api_key_ciphertext=$4,enabled=$5,updated_at=NOW()
       WHERE id=$6 RETURNING *`,[...fields,id])
    :await db.query<ProviderRow>(`INSERT INTO ai_provider_connections
       (name,base_url,api_style,api_key_ciphertext,enabled)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,fields);
  return providerPublic(rows[0]);
}
export async function deleteProvider(db:DbClient,id:string):Promise<boolean>{
  const {rowCount}=await db.query('DELETE FROM ai_provider_connections WHERE id=$1',[id]);
  return Boolean(rowCount);
}
export async function saveModelConfig(db:DbClient,id:string|null,value:ModelInput):Promise<ModelPublic>{
  await db.query('SELECT pg_advisory_xact_lock(21844,7302)');
  const existing=id?(await db.query<ModelRow>(
    'SELECT * FROM ai_model_configs WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
  if(id&&!existing)throw new Error('MODEL_NOT_FOUND');
  const provider=(await db.query<ProviderRow>(
    'SELECT * FROM ai_provider_connections WHERE id=$1 FOR UPDATE',[value.providerId])).rows[0];
  if(!provider)throw new Error('PROVIDER_NOT_FOUND');
  if(value.isDefault&&(!value.enabled||!provider.enabled||!provider.api_key_ciphertext))
    throw new Error('MODEL_DEFAULT_UNAVAILABLE');
  if(value.reasoning!=='auto'&&value.reasoningFormat==='none'&&value.reasoning!=='none')
    throw new Error('MODEL_REASONING_UNSUPPORTED');
  if(value.reasoningFormat==='responses-effort'&&provider.api_style!=='responses'||
     value.reasoningFormat==='chat-completions-effort'&&provider.api_style!=='chat-completions')
    throw new Error('MODEL_REASONING_STYLE_MISMATCH');
  if(value.isDefault)
    await db.query('UPDATE ai_model_configs SET is_default=FALSE WHERE is_default=TRUE');
  const fields=[value.name,value.model,value.providerId,value.reasoning,value.reasoningFormat,
    value.maxOutputTokens,value.contextChars,value.enabled,value.isDefault];
  const {rows}=id
    ?await db.query<ModelRow>(`UPDATE ai_model_configs SET name=$1,model_id=$2,
      provider_id=$3,reasoning=$4,reasoning_format=$5,max_output_tokens=$6,
      context_chars=$7,enabled=$8,is_default=$9,updated_at=NOW()
      WHERE id=$10 RETURNING *`,[...fields,id])
    :await db.query<ModelRow>(`INSERT INTO ai_model_configs
      (name,model_id,provider_id,reasoning,reasoning_format,max_output_tokens,
       context_chars,enabled,is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,fields);
  return modelPublic(rows[0]);
}
export async function deleteModelConfig(db:DbClient,id:string):Promise<boolean>{
  const {rowCount}=await db.query('DELETE FROM ai_model_configs WHERE id=$1',[id]);
  return Boolean(rowCount);
}
export async function resolveModelConfig(
  id?:string,allowDisabled=false,db:DbClient|typeof pool=pool,
):Promise<LLMSettings>{
  const {rows}=await db.query<EffectiveRow>(`SELECT m.*,p.base_url,p.api_style,
       p.api_key_ciphertext,p.enabled AS provider_enabled
    FROM ai_model_configs m JOIN ai_provider_connections p ON p.id=m.provider_id
    WHERE ${id?'m.id=$1':'m.enabled=TRUE AND m.is_default=TRUE'}`,id?[id]:[]);
  const model=rows[0];
  if(!model||(!allowDisabled&&!model.provider_enabled)||!model.api_key_ciphertext||
     (!allowDisabled&&!model.enabled))throw new Error('MODEL_NOT_CONFIGURED');
  const config=readLLMSettings({
    LLM_API_KEY:decryptModelKey(model.api_key_ciphertext),
    LLM_BASE_URL:validateModelUrl(model.base_url),
    LLM_MODEL:model.model_id,LLM_API_STYLE:model.api_style,
  });
  return {...config,reasoning:model.reasoning,reasoningFormat:model.reasoning_format,
    maxOutputTokens:model.max_output_tokens,contextChars:model.context_chars};
}
export async function resolveProjectModel(
  projectId:string,db:DbClient|typeof pool=pool,
):Promise<LLMSettings>{
  const found=await db.query('SELECT 1 FROM projects WHERE id=$1',[projectId]);
  if(!found.rowCount)throw new Error('PROJECT_NOT_FOUND');
  return resolveModelConfig(undefined,false,db);
}


/** Catalog probes are allowed before the connection is enabled. */
export async function resolveProviderCatalogConfig(id:string,db:DbClient):Promise<{baseUrl:string;apiKey:string}>{
  const {rows}=await db.query<ProviderRow>(
    'SELECT * FROM ai_provider_connections WHERE id=$1',[id]);
  const provider=rows[0];
  if(!provider)throw new Error('PROVIDER_NOT_FOUND');
  if(!provider.api_key_ciphertext)throw new Error('MODEL_KEY_REQUIRED');
  return {baseUrl:validateModelUrl(provider.base_url),
    apiKey:decryptModelKey(provider.api_key_ciphertext)};
}

export type CatalogImport={id:string;name?:string};
export function importModelName(model:CatalogImport):string{
  const name=model.name?.trim()||model.id;
  if(name.length<=100)return name;
  // Avoid collisions when different long identifiers share a prefix.
  return name.slice(0,91)+'-'+createHash('sha256').update(model.id).digest('hex').slice(0,8);
}

/** All-or-nothing, idempotent import; imported models start disabled. */
export async function importModelConfigs(
  db:DbClient,providerId:string,items:CatalogImport[],
):Promise<{created:number;skipped:number}>{
  const provider=await db.query('SELECT 1 FROM ai_provider_connections WHERE id=$1 FOR UPDATE',[providerId]);
  if(!provider.rowCount)throw new Error('PROVIDER_NOT_FOUND');
  let created=0,skipped=0;
  const visited=new Set<string>();
  for(const item of items){
    if(visited.has(item.id)){skipped++;continue;}
    visited.add(item.id);
    const preferred=importModelName(item);
    const fallback=importModelName({id:item.id});
    let handled=false;
    // Two remote IDs may carry the same display name. Retain a friendly
    // label when free, otherwise fall back to a stable ID-derived name.
    for(const label of new Set([preferred,fallback])){
      const result=await db.query(
        `INSERT INTO ai_model_configs
          (name,model_id,provider_id,reasoning,reasoning_format,
           max_output_tokens,context_chars,enabled,is_default)
         VALUES($1,$2,$3,'auto','none',8192,32768,FALSE,FALSE)
         ON CONFLICT DO NOTHING RETURNING id`,
        [label,item.id,providerId],
      );
      if(result.rowCount){created++;handled=true;break;}
      const existing=await db.query(
        'SELECT 1 FROM ai_model_configs WHERE provider_id=$1 AND model_id=$2',
        [providerId,item.id]);
      if(existing.rowCount){skipped++;handled=true;break;}
    }
    if(!handled)throw new Error('MODEL_IMPORT_NAME_CONFLICT');
  }
  return {created,skipped};
}
