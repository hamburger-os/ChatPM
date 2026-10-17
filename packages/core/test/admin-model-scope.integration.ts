import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {systemAdminTransaction} from '../src/identity/system-access.ts';
import {listProviders,listModelConfigs,resolveModelConfig,
  resolveProviderCatalogConfig,saveProvider,saveModelConfig} from '../src/project-model.ts';

const suffix=randomUUID();
let providerId:string|null=null;
let modelId:string|null=null;
let release:()=>void=()=>{};
try{
  const admin=(await pool.query<{id:string}>(`
    INSERT INTO users(email,display_name,password_hash,is_system_admin)
    VALUES($1,'Model admin','unused',TRUE) RETURNING id
  `,['model-admin-'+suffix+'@example.test'])).rows[0].id;
  const member=(await pool.query<{id:string}>(`
    INSERT INTO users(email,display_name,password_hash,is_system_admin)
    VALUES($1,'Model non-admin','unused',FALSE) RETURNING id
  `,['model-member-'+suffix+'@example.test'])).rows[0].id;

  const secret='model-test-secret-'+suffix;
  const provider=await systemAdminTransaction(admin,db=>saveProvider(db,null,{
    name:'Model provider '+suffix,baseUrl:'https://example.com/v1',
    style:'responses',apiKey:secret,enabled:true,
  }));
  providerId=provider.id;
  const model=await systemAdminTransaction(admin,db=>saveModelConfig(db,null,{
    name:'Model scope '+suffix,model:'test-model',providerId:provider.id,
    reasoning:'auto',reasoningFormat:'none',maxOutputTokens:512,contextChars:2000,
    enabled:true,isDefault:false,
  }));
  modelId=model.id;

  const read=async(actorId:string)=>systemAdminTransaction(actorId,async db=>({
    providers:await listProviders(db),models:await listModelConfigs(db),
  }));
  const initial=await read(admin);
  assert.equal(initial.providers.find(x=>x.id===provider.id)?.hasKey,true);
  assert.equal(initial.models.find(x=>x.id===model.id)?.providerId,provider.id);
  assert.ok(!JSON.stringify(initial).includes(secret),
    'Protected metadata must not include model credentials');
  await assert.rejects(read(member),/仅系统总管理员可以执行此操作/);

  const catalog=await systemAdminTransaction(admin,db=>
    resolveProviderCatalogConfig(provider.id,db));
  assert.equal(catalog.baseUrl,'https://example.com/v1');
  assert.equal(catalog.apiKey,secret);
  await assert.rejects(systemAdminTransaction(member,db=>
    resolveProviderCatalogConfig(provider.id,db)),
  /仅系统总管理员可以执行此操作/);

  const config=await systemAdminTransaction(admin,db=>
    resolveModelConfig(model.id,true,db));
  assert.equal(config.apiKey,secret);
  await assert.rejects(systemAdminTransaction(member,db=>
    resolveModelConfig(model.id,true,db)),
  /仅系统总管理员可以执行此操作/);

  // A current admin model-list query holds the same user-row lock as the
  // platform privilege update. Revocation cannot complete halfway through.
  let acquired!:()=>void;
  const ready=new Promise<void>(r=>{acquired=r;});
  const gate=new Promise<void>(r=>{release=r;});
  const pending=systemAdminTransaction(admin,async db=>{
    acquired();
    await gate;
    const result=await listProviders(db);
    return result.find(x=>x.id===provider.id)?.id;
  });
  const other=await pool.connect();
  try{
    await ready;
    await other.query('BEGIN');
    await other.query("SET LOCAL lock_timeout='200ms'");
    await assert.rejects(other.query(`
      UPDATE users SET is_system_admin=FALSE WHERE id=$1
    `,[admin]),(e:unknown)=>(e as {code?:string}).code==='55P03');
    await other.query('ROLLBACK');
    release();
    assert.equal(await pending,provider.id);
  }finally{
    release();
    try{await other.query('ROLLBACK');}catch{}
    other.release();
  }
  await pool.query('UPDATE users SET is_system_admin=FALSE WHERE id=$1',[admin]);
  await assert.rejects(read(admin),/仅系统总管理员可以执行此操作/);
  await assert.rejects(systemAdminTransaction(admin,db=>
    resolveProviderCatalogConfig(provider.id,db)),
  /仅系统总管理员可以执行此操作/);
  console.log('System model admin reads: one locked grant, no leaked key, denial and revocation');
}finally{
  release();
  if(modelId){
    await pool.query('DELETE FROM ai_model_checks WHERE model_config_id=$1',[modelId]);
    await pool.query('DELETE FROM ai_model_configs WHERE id=$1',[modelId]);
  }
  if(providerId)await pool.query('DELETE FROM ai_provider_connections WHERE id=$1',[providerId]);
  await pool.end();
}
