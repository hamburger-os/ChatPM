import {
  assertPublicModelHost,secureModelFetch,
} from './model-egress.ts';
export {assertPublicModelHost,isPrivateModelAddress} from './model-egress.ts';

export type CatalogModel={id:string;name:string;ownedBy:string|null};
export type CatalogResult={models:CatalogModel[];latencyMs:number;truncated:boolean};
async function readSmallJson(response:Response):Promise<unknown>{
  const declared=Number(response.headers.get('content-length')??0);
  if(declared>512_000)throw new Error('MODEL_CATALOG_TOO_LARGE');
  if(!response.body)throw new Error('MODEL_CATALOG_INVALID_RESPONSE');
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>512_000)throw new Error('MODEL_CATALOG_TOO_LARGE');
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const buffer=new Uint8Array(total);
  let offset=0;
  for(const part of chunks){buffer.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(buffer));}
  catch{throw new Error('MODEL_CATALOG_INVALID_RESPONSE');}
}

export async function discoverProviderModels(
  config:{baseUrl:string;apiKey:string},
  fetchImpl:typeof fetch=secureModelFetch,
  checkHost:typeof assertPublicModelHost=assertPublicModelHost,
):Promise<CatalogResult>{
  await checkHost(config.baseUrl);
  const started=Date.now();
  let response:Response;
  try{
    response=await fetchImpl(config.baseUrl+'/models',{
      method:'GET',redirect:'error',
      headers:{
        Accept:'application/json',
        ...(config.apiKey?{Authorization:'Bearer '+config.apiKey}:{}),
      },
      signal:AbortSignal.timeout(10_000),
    });
  }catch{throw new Error('MODEL_CATALOG_NETWORK_ERROR');}
  if(!response.ok){
    if([401,403,404,405,429].includes(response.status))
      throw new Error('MODEL_CATALOG_HTTP_'+response.status);
    throw new Error('MODEL_CATALOG_HTTP_ERROR');
  }
  const payload=await readSmallJson(response);
  if(!payload||typeof payload!=='object'||!('data' in payload)||
    !Array.isArray(payload.data))
    throw new Error('MODEL_CATALOG_INVALID_RESPONSE');
  const results=new Map<string,CatalogModel>();
  for(const row of payload.data){
    if(!row||typeof row!=='object'||typeof row.id!=='string')continue;
    const id=row.id.trim();
    if(!id||id.length>150||/[\r\n]/.test(id)||results.has(id))continue;
    const name=typeof row.name==='string'&&row.name.trim()
      ?row.name.trim().slice(0,100):id.slice(0,100);
    results.set(id,{id,name,ownedBy:typeof row.owned_by==='string'
      ?row.owned_by.slice(0,100):null});
    if(results.size>=500)break;
  }
  const models=[...results.values()].sort((a,b)=>a.id.localeCompare(b.id));
  return {models,latencyMs:Date.now()-started,truncated:payload.data.length>results.size};
}
