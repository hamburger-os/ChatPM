import assert from 'node:assert/strict';
import {ZodError} from 'zod';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {systemAdminTransaction} from '../src/identity/system-access.ts';
import {listProviders,listModelConfigs} from '../src/project-model.ts';
import {
  createPlatformProvider,updatePlatformProvider,deletePlatformProvider,
  importPlatformModels,createPlatformModel,updatePlatformModel,
  deletePlatformModel,preparePlatformModelTest,
} from '../src/identity/platform-model-commands.ts';

const suffix=randomUUID();
const createdModelIds:string[]=[];
let providerId:string|null=null;
try{
  async function actor(admin:boolean){
    const {rows}=await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash,is_system_admin)
      VALUES($1,'Model command fixture','unused',$2) RETURNING id
    `,[(admin?'platform-command-admin-':'platform-command-member-')+suffix+'@example.test',admin]);
    return rows[0].id;
  }
  const admin=await actor(true),member=await actor(false);
  const key='model-key-'+suffix;
  const initial={name:'Provider '+suffix,baseUrl:'https://model.example/v1',
    style:'responses' as const,apiKey:key,enabled:true};

  await assert.rejects(createPlatformProvider(member,{name:'not a valid DTO'}),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===403,
    'Privilege denial must win over Zod parsing of untrusted model input');
  await assert.rejects(createPlatformModel(member,{unexpected:true}),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===403);
  await assert.rejects(importPlatformModels(member,{providerId:'not-an-id'}),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===403);
  await assert.rejects(createPlatformProvider(admin,{name:'missing-fields'}),
    (e:unknown)=>e instanceof ZodError,'Authorized but invalid input must never be persisted');

  const provider=await createPlatformProvider(admin,initial);
  providerId=provider.id;
  assert.equal(provider.hasKey,true);
  assert.ok(!JSON.stringify(provider).includes(key));
  const changed=await updatePlatformProvider(admin,provider.id,{
    ...initial,name:'Renamed provider '+suffix,apiKey:undefined,
  });
  assert.equal(changed.hasKey,true);
  assert.equal(changed.name,'Renamed provider '+suffix);

  const imported=await importPlatformModels(admin,{
    providerId:provider.id,models:[
      {id:'remote-model-alpha',name:'Remote Alpha'},
      {id:'remote-model-beta',name:'Remote Beta'},
    ],
  });
  assert.deepEqual(imported,{created:2,skipped:0});
  assert.deepEqual(await importPlatformModels(admin,{
    providerId:provider.id,models:[
      {id:'remote-model-alpha',name:'Remote Alpha'},
      {id:'remote-model-beta',name:'Remote Beta'},
    ],
  }),{created:0,skipped:2});
  const discovered=await systemAdminTransaction(admin,db=>listModelConfigs(db));
  const inactive=discovered.filter(x=>x.providerId===provider.id);
  assert.equal(inactive.length,2);
  assert.ok(inactive.every(x=>!x.enabled&&!x.isDefault));
  createdModelIds.push(...inactive.map(x=>x.id));

  const model=await createPlatformModel(admin,{
    name:'Model '+suffix,model:'configured-model',providerId:provider.id,
    reasoning:'auto',reasoningFormat:'none',maxOutputTokens:512,
    contextChars:2000,enabled:true,isDefault:false,
  });
  createdModelIds.push(model.id);
  const updated=await updatePlatformModel(admin,model.id,{
    name:'Updated model '+suffix,model:'configured-model-v2',
    providerId:provider.id,reasoning:'none',reasoningFormat:'none',
    maxOutputTokens:1024,contextChars:3000,enabled:true,isDefault:false,
  });
  assert.equal(updated.model,'configured-model-v2');

  const prepared=await preparePlatformModelTest(admin,model.id,{mode:'quick'});
  assert.equal(prepared.mode,'quick');
  assert.equal(prepared.config.model,'configured-model-v2');
  assert.equal(prepared.config.apiKey,key);
  await assert.rejects(preparePlatformModelTest(admin,model.id,{mode:'full'}),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===429,
    'Billable model checks must use one serialized cooldown receipt');
  await assert.rejects(preparePlatformModelTest(member,model.id,{mode:'invalid'}),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===403,
    'Revoked or ordinary members must not read API keys even on invalid probes');

  await assert.rejects(deletePlatformProvider(admin,provider.id),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===409,
    'A provider with configured models cannot be deleted');
  await pool.query('DELETE FROM ai_model_checks WHERE model_config_id=$1',[model.id]);
  for(const id of createdModelIds)assert.deepEqual(
    await deletePlatformModel(admin,id),{ok:true});
  await assert.rejects(deletePlatformModel(admin,model.id),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===404);
  assert.deepEqual(await deletePlatformProvider(admin,provider.id),{ok:true});
  providerId=null;
  await assert.rejects(deletePlatformProvider(admin,provider.id),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===404);

  const audits=await pool.query<{action:string;metadata:unknown}>(`
    SELECT action,metadata FROM system_audit_entries
    WHERE actor_id=$1 AND action LIKE 'ai.%'
    ORDER BY created_at,id
  `,[admin]);
  assert.deepEqual(audits.rows.map(x=>x.action).sort(),[
    'ai.model_created','ai.model_deleted','ai.model_deleted','ai.model_deleted',
    'ai.model_updated','ai.models_imported','ai.models_imported',
    'ai.provider_created','ai.provider_deleted','ai.provider_updated',
  ].sort());
  assert.equal(JSON.stringify(audits.rows).includes(key),false,
    'System audit must never serialize plaintext model API keys');
  const current=await systemAdminTransaction(admin,db=>listProviders(db));
  assert.equal(current.some(x=>x.id===provider.id),false);

  await pool.query('UPDATE users SET is_system_admin=FALSE WHERE id=$1',[admin]);
  await assert.rejects(createPlatformProvider(admin,initial),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===403);
  await assert.rejects(preparePlatformModelTest(admin,model.id,{mode:'quick'}),
    (e:unknown)=>(e as {statusCode?:number}).statusCode===403);
  console.log('Model Core commands: grant before DTO, secret-safe audit, lifecycle, idempotent import and cooldown');
}finally{
  for(const id of createdModelIds){
    await pool.query('DELETE FROM ai_model_checks WHERE model_config_id=$1',[id]);
    await pool.query('DELETE FROM ai_model_configs WHERE id=$1',[id]);
  }
  if(providerId)await pool.query('DELETE FROM ai_provider_connections WHERE id=$1',[providerId]);
  await pool.end();
}
