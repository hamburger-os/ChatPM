import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { systemAdminTransaction } from '../../../packages/core/src/identity/system-access.ts';
import {
  listModelConfigs,listProviders,resolveProviderCatalogConfig,
} from '../../../packages/core/src/project-model.ts';
import {
  createPlatformProvider,updatePlatformProvider,deletePlatformProvider,
  importPlatformModels,createPlatformModel,updatePlatformModel,
  deletePlatformModel,preparePlatformModelTest,
} from '../../../packages/core/src/identity/platform-model-commands.ts';
import { discoverProviderModels } from '../../../packages/core/src/model-catalog.ts';
import { callStructuredLLM, modelAuditIdentity, probeModelText } from '../../../packages/core/src/llm-transport.ts';

const uuid=z.string().uuid();
const denied=(code:number,message:string):never=>{
  throw Object.assign(new Error(message),{statusCode:code});
};

export function registerAdminModelRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.get('/admin/ai/providers',async req=>{
    const actor=await authenticated(req);
    return systemAdminTransaction(actor,async db=>({providers:await listProviders(db)}));
  });
  app.post('/admin/ai/providers',async(req,reply)=>{
    const actor=await authenticated(req);
    const provider=await createPlatformProvider(actor,req.body);
    return reply.code(201).send({provider});
  });
  app.put('/admin/ai/providers/:id',async req=>{
    const actor=await authenticated(req),id=uuid.parse((req.params as {id:string}).id);
    return {provider:await updatePlatformProvider(actor,id,req.body)};
  });
  app.delete('/admin/ai/providers/:id',async req=>{
    const actor=await authenticated(req),id=uuid.parse((req.params as {id:string}).id);
    return deletePlatformProvider(actor,id);
  });

  app.post('/admin/ai/providers/:id/discover',async req=>{
    const actor=await authenticated(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const connection=await systemAdminTransaction(actor,db=>
      resolveProviderCatalogConfig(id,db));
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
    const actor=await authenticated(req);
    const result=await importPlatformModels(actor,req.body);
    return reply.code(201).send(result);
  });

  app.get('/admin/ai/models',async req=>{
    const actor=await authenticated(req);
    return systemAdminTransaction(actor,async db=>({models:await listModelConfigs(db)}));
  });
  app.post('/admin/ai/models',async(req,reply)=>{
    const actor=await authenticated(req);
    const model=await createPlatformModel(actor,req.body);
    return reply.code(201).send({model});
  });
  app.put('/admin/ai/models/:id',async req=>{
    const actor=await authenticated(req),id=uuid.parse((req.params as {id:string}).id);
    return {model:await updatePlatformModel(actor,id,req.body)};
  });
  app.delete('/admin/ai/models/:id',async req=>{
    const actor=await authenticated(req),id=uuid.parse((req.params as {id:string}).id);
    return deletePlatformModel(actor,id);
  });
  app.post('/admin/ai/models/:id/test',async req=>{
    const actor=await authenticated(req);
    const id=uuid.parse((req.params as {id:string}).id);
    const {config,mode}=await preparePlatformModelTest(actor,id,req.body);
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
