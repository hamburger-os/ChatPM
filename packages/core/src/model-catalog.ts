import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

// Deliberately narrow: provider discovery is an authenticated, server-side
// request to a saved administrator-controlled API endpoint, never a URL
// supplied by an ordinary member or by the upstream model catalog.
const forbidden=new BlockList();
for(const [subnet,prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],
  ['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],
  ['240.0.0.0',4],['192.0.2.0',24],['198.51.100.0',24],
  ['203.0.113.0',24],
] as const)forbidden.addSubnet(subnet,prefix,'ipv4');
for(const [subnet,prefix] of [
  ['::',128],['::1',128],['fc00::',7],['fe80::',10],
  ['ff00::',8],['2001:db8::',32],['::ffff:0:0',96],
  ['2002::',16],['2001::',32],['64:ff9b::',96],
] as const)forbidden.addSubnet(subnet,prefix,'ipv6');

export type CatalogModel={id:string;name:string;ownedBy:string|null};
export type CatalogResult={models:CatalogModel[];latencyMs:number;truncated:boolean};
export function isPrivateModelAddress(address:string):boolean{
  const type=isIP(address);
  return !type||forbidden.check(address,type===4?'ipv4':'ipv6');
}

export async function assertPublicModelHost(
  baseUrl:string,resolve:typeof lookup=lookup,
):Promise<void>{
  const url=new URL(baseUrl);
  // Local integrations are an explicit administrator-controlled trust choice.
  if(['localhost','127.0.0.1','[::1]','host.docker.internal'].includes(url.hostname.toLowerCase()))
    return;
  if(isIP(url.hostname)){
    if(isPrivateModelAddress(url.hostname))throw new Error('MODEL_CATALOG_UNSAFE_ENDPOINT');
    return;
  }
  let addresses:{address:string;family:number}[];
  try{addresses=await resolve(url.hostname,{all:true});}
  catch{throw new Error('MODEL_CATALOG_DNS_FAILED');}
  if(!Array.isArray(addresses)||addresses.length===0||
    addresses.some(item=>isPrivateModelAddress(item.address)))
    throw new Error('MODEL_CATALOG_UNSAFE_ENDPOINT');
}

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
  fetchImpl:typeof fetch=fetch,
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
