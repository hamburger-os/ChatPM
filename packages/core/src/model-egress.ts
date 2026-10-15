import {lookup as dnsLookup} from 'node:dns/promises';
import type {LookupAddress} from 'node:dns';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {BlockList,isIP} from 'node:net';

// Only these literal administrator-selected endpoints may reach a local model.
// Arbitrary *.local, RFC1918 IPs or internal DNS aliases are NOT equivalent.
const trustedLocal=new Set(['localhost','127.0.0.1','::1','host.docker.internal']);
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
  ['ff00::',8],['2001:db8::',32],['2002::',16],
  ['2001::',32],['64:ff9b::',96],
] as const)forbidden.addSubnet(subnet,prefix,'ipv6');

function hostOf(url:URL):string{
  return url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
}
export function isPrivateModelAddress(address:string):boolean{
  const family=isIP(address);
  return !family||forbidden.check(address,family===4?'ipv4':'ipv6');
}
function invalidUrl():never{throw new Error('MODEL_EGRESS_INVALID_URL');}
function unsafe():never{throw new Error('MODEL_CATALOG_UNSAFE_ENDPOINT');}
type Resolver=typeof dnsLookup;

function validateTarget(url:URL):{host:string;local:boolean}{
  const host=hostOf(url);
  const local=trustedLocal.has(host);
  if(!host||url.username||url.password||url.search||url.hash||
     (url.protocol!=='https:'&&!(url.protocol==='http:'&&local)))
    invalidUrl();
  return {host,local};
}
async function pinnedModelAddress(url:URL,resolve:Resolver=dnsLookup):
  Promise<LookupAddress>{
  const {host,local}=validateTarget(url);
  const literalFamily=isIP(host);
  if(literalFamily){
    if(!local&&isPrivateModelAddress(host))unsafe();
    return {address:host,family:literalFamily};
  }
  let addresses:LookupAddress[];
  try{addresses=await resolve(host,{all:true});}
  catch{throw new Error('MODEL_CATALOG_DNS_FAILED');}
  if(!Array.isArray(addresses)||!addresses.length)unsafe();
  for(const address of addresses){
    if(!isIP(address.address)||![4,6].includes(address.family))unsafe();
    if(local){
      const privateIp=isPrivateModelAddress(address.address);
      const loopback=address.address==='::1'||
        /^127\./.test(address.address);
      if(!privateIp||(host==='localhost'&&!loopback))unsafe();
    }else if(isPrivateModelAddress(address.address))unsafe();
  }
  // Subsequent socket creation uses ONLY this already checked address:
  // there is no second DNS lookup that can be rebound to 169.254/loopback.
  return addresses[0];
}

export async function assertPublicModelHost(baseUrl:string,
  resolve:Resolver=dnsLookup):Promise<void>{
  let url:URL;
  try{url=new URL(baseUrl);}catch{invalidUrl();}
  await pinnedModelAddress(url,resolve);
}

/**
 * Production model transport: Node HTTP(S) using a pinned socket lookup.
 * No redirects, keepalive/pooling, environment HTTP proxies or raw upstream
 * error logs. Limits apply to every response, including non-2xx responses.
 * Tests may inject an in-memory fetch at the caller boundary.
 */
export const secureModelFetch:typeof fetch=async(input,init)=>{
  if(typeof input!=='string'&&!(input instanceof URL))invalidUrl();
  let url:URL;
  try{url=new URL(input);}catch{invalidUrl();}
  const {host}=validateTarget(url);
  if(init?.redirect!=='error')throw new Error('MODEL_EGRESS_REDIRECT_POLICY');
  const method=init?.method??'GET';
  if(method!=='GET'&&method!=='POST')throw new Error('MODEL_EGRESS_INVALID_METHOD');
  if(init?.body!=null&&typeof init.body!=='string')
    throw new Error('MODEL_EGRESS_INVALID_BODY');
  const pinned=await pinnedModelAddress(url);
  const headers:Record<string,string>={'Accept-Encoding':'identity'};
  new Headers(init?.headers).forEach((value,name)=>{headers[name]=value;});
  const maxBytes=url.pathname.endsWith('/models')?512_000:2_000_000;
  const send=url.protocol==='https:'?httpsRequest:httpRequest;
  return new Promise<Response>((resolve,reject)=>{
    let settled=false;
    const fail=(message:string)=>{
      if(!settled){settled=true;reject(new Error(message));}
    };
    const req=send(url,{
      method,agent:false,headers,signal:init?.signal??undefined,
      lookup:(_hostname,options,cb)=>{
        if(typeof options==='object'&&options.all){
          (cb as (error:NodeJS.ErrnoException|null,rows:LookupAddress[])=>void)(
            null,[pinned]);
        }else{
          (cb as (error:NodeJS.ErrnoException|null,address:string,family:number)=>void)(
            null,pinned.address,pinned.family);
        }
      },
      servername:url.protocol==='https:'&&!isIP(host)?host:undefined,
    },res=>{
      const status=res.statusCode??502;
      if(status>=300&&status<400){
        res.destroy();fail('MODEL_EGRESS_REDIRECT_BLOCKED');return;
      }
      const declared=Number(res.headers['content-length']??0);
      if(declared>maxBytes){
        res.destroy();fail('MODEL_EGRESS_RESPONSE_TOO_LARGE');return;
      }
      const chunks:Buffer[]=[];let total=0;
      res.on('data',(chunk:Buffer)=>{
        total+=chunk.length;
        if(total>maxBytes){
          res.destroy();fail('MODEL_EGRESS_RESPONSE_TOO_LARGE');return;
        }
        chunks.push(chunk);
      });
      res.on('error',()=>fail('MODEL_EGRESS_NETWORK_ERROR'));
      res.on('end',()=>{
        if(settled)return;
        const headers:Record<string,string>={};
        if(typeof res.headers['content-type']==='string')
          headers['content-type']=res.headers['content-type'];
        settled=true;
        try{resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),
          {status,headers}));}
        catch{reject(new Error('MODEL_EGRESS_INVALID_RESPONSE'));}
      });
    });
    req.on('error',()=>fail('MODEL_EGRESS_NETWORK_ERROR'));
    if(init?.body)req.write(init.body);
    req.end();
  });
};
