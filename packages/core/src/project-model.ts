import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { DbClient } from './db.ts';
import { pool } from './db.ts';
import { readLLMSettings, type LLMSettings, type LLMApiStyle } from './llm-transport.ts';

export type ProjectModelProvider='server'|'openai'|'deepseek';
export type ProjectModelSettings={
  provider:ProjectModelProvider; model:string; style:LLMApiStyle;
  reasoning:'auto'|'low'|'medium'|'high';
  maxOutputTokens:number;contextChars:number;hasKey:boolean;
};
type ModelRow={
  model_provider:ProjectModelProvider;model_id:string;model_api_style:LLMApiStyle;
  model_key_ciphertext:string|null;model_reasoning:ProjectModelSettings['reasoning'];
  model_max_output_tokens:number;model_context_chars:number;
};
const endpoints={
  openai:'https://api.openai.com/v1',
  deepseek:'https://api.deepseek.com',
} as const;

function key(){
  const secret=process.env.SESSION_SECRET;
  if(!secret || secret.length<32)throw new Error('MODEL_ENCRYPTION_NOT_CONFIGURED');
  return createHash('sha256').update('chatpm:model-secret:v1:').update(secret).digest();
}
export function encryptModelKey(value:string):string{
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(),nonce);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
}
export function decryptModelKey(value:string):string{
  try {
    const data=Buffer.from(value,'base64');
    if(data.length<29)throw new Error('invalid');
    const cipher=createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));
    cipher.setAuthTag(data.subarray(12,28));
    return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8');
  }catch {throw new Error('MODEL_KEY_DECRYPTION_FAILED');}
}
async function findModel(projectId:string):Promise<ModelRow>{
  const {rows}=await pool.query(
    `SELECT model_provider,model_id,model_api_style,model_key_ciphertext,model_reasoning,
            model_max_output_tokens,model_context_chars FROM projects WHERE id=$1`,
    [projectId]);
  if(!rows[0])throw new Error('PROJECT_NOT_FOUND');
  return rows[0] as ModelRow;
}
export async function publicModelSettings(projectId:string):Promise<ProjectModelSettings>{
  const row=await findModel(projectId);
  return {provider:row.model_provider,model:row.model_id,style:row.model_api_style,
    reasoning:row.model_reasoning,maxOutputTokens:row.model_max_output_tokens,
    contextChars:row.model_context_chars,hasKey:row.model_provider==='server'
      ? Boolean(process.env.LLM_API_KEY?.trim()):Boolean(row.model_key_ciphertext)};
}
export async function resolveProjectModel(projectId:string):Promise<LLMSettings>{
  const row=await findModel(projectId);
  if(row.model_provider==='server'){
    const config=readLLMSettings();
    return {...config,maxOutputTokens:row.model_max_output_tokens,
      contextChars:row.model_context_chars,reasoning:row.model_reasoning};
  }
  if(!row.model_key_ciphertext)throw new Error('MODEL_NOT_CONFIGURED');
  const config=readLLMSettings({
    LLM_API_KEY:decryptModelKey(row.model_key_ciphertext),
    LLM_BASE_URL:endpoints[row.model_provider],
    LLM_MODEL:row.model_id|| (row.model_provider==='deepseek'?'deepseek-flash':'gpt-4.1-mini'),
    LLM_API_STYLE:row.model_api_style,
  });
  return {...config,maxOutputTokens:row.model_max_output_tokens,
    contextChars:row.model_context_chars,reasoning:row.model_reasoning};
}
export async function updateProjectModel(
  db:DbClient,projectId:string,value:ProjectModelSettings & {apiKey?:string;clearKey?:boolean},
){
  if(value.provider!=='server' && !value.model.trim())throw new Error('MODEL_INVALID_MODEL');
  const old=(await db.query('SELECT model_provider,model_key_ciphertext FROM projects WHERE id=$1 FOR UPDATE',
    [projectId])).rows[0];
  if(!old)throw new Error('PROJECT_NOT_FOUND');
  const ciphertext=value.provider==='server'||value.clearKey?null:value.apiKey
    ? encryptModelKey(value.apiKey)
    : value.provider===old.model_provider?old.model_key_ciphertext:null;
  await db.query(`UPDATE projects SET model_provider=$2,model_id=$3,model_api_style=$4,
      model_key_ciphertext=$5,model_reasoning=$6,model_max_output_tokens=$7,
      model_context_chars=$8 WHERE id=$1`,
    [projectId,value.provider,value.model.trim(),value.style,ciphertext,value.reasoning,
      value.maxOutputTokens,value.contextChars]);
}
