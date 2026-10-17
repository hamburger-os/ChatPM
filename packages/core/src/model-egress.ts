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
  ['203.0.113.0',24],['192.88.99.0',24],
] as const)forbidden.addSubnet(subnet,prefix,'ipv4');
for(const [subnet,prefix] of [
  ['::',128],['::1',128],['fc00::',7],['fe80::',10],
  ['ff00::',8],['2001:db8::',32],['2002::',16],
  ['2001::',32],['64:ff9b::',96],['64:ff9b:1::',48],
  ['fec0::',10],
] as const)forbidden.addSubnet(subnet,prefix,'ipv6');

function hostOf(url:URL):string{
  return url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
}
export function isPrivateModelAddress(address:string):boolean{
  const family=isIP(address);
  return !family||forbidden.check(address,family===4?'ipv4':'ipv6');
}
// Docker host gateway may legitimately use RFC1918/ULA addresses, but it
// must NEVER resolve to link-local/cloud metadata, CGNAT, benchmark, loopback
// or globally routable endpoints. This is narrower than 'any private IP'.
const dockerGateway=new BlockList();
for(const [net,prefix] of [
  ['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],
] as const)dockerGateway.addSubnet(net,prefix,'ipv4');
dockerGateway.addSubnet('fc00::',7,'ipv6');
export function isAllowedDockerGatewayAddress(address:string):boolean{
  const family=isIP(address);
  return family!==0&&dockerGateway.check(address,family===4?'ipv4':'ipv6');
}
function invalidUrl():never{throw new Error('MODEL_EGRESS_INVALID_URL');}
function unsafe():never{throw new Error('MODEL_CATALOG_UNSAFE_ENDPOINT');}

/** Explicit deployment pin for the ONLY accepted Docker host-gateway alias.
 * Merely resolving host.docker.internal to some RFC1918/ULA address is not
 * sufficient: a poisoned first DNS answer could point at another LAN service.
 * This is a deployer allowlist, not model/provider/user controlled data.
 */
function pinnedDockerGateways(value:string|undefined):BlockList{
  if(!value||value.length>256)unsafe();
  const entries=value.split(',');
  if(entries.length<1||entries.length>4)unsafe();
  const allow=new BlockList();
  for(const raw of entries){
    const address=raw.trim();
    if(!isAllowedDockerGatewayAddress(address))unsafe();
    allow.addAddress(address,isIP(address)===4?'ipv4':'ipv6');
  }
  return allow;
}
type Resolver=(hostname:string,options:{all:true})=>Promise<LookupAddress[]>;

function validateTarget(url:URL):{host:string;local:boolean}{
  const host=hostOf(url);
  const local=trustedLocal.has(host);
  if(!host||url.username||url.password||url.search||url.hash||
     (url.protocol!=='https:'&&!(url.protocol==='http:'&&local)))
    invalidUrl();
  return {host,local};
}
async function pinnedModelAddress(
  url:URL,resolve:Resolver=dnsLookup,
  dockerGatewayIps=process.env.MODEL_DOCKER_GATEWAY_IPS,
):Promise<LookupAddress>{
  const {host,local}=validateTarget(url);
  // Fail BEFORE DNS if the local Docker exception has no static allowlist.
  const gateway=host==='host.docker.internal'
    ?pinnedDockerGateways(dockerGatewayIps):null;
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
    if(isIP(address.address)!==address.family)unsafe();
    if(local){
      const loopback=address.address==='::1'||
        /^127\./.test(address.address);
      if(host==='localhost'){
        if(!loopback)unsafe();
      }else if(!gateway||!isAllowedDockerGatewayAddress(address.address)||
        !gateway.check(address.address,address.family===4?'ipv4':'ipv6'))unsafe();
    }else if(isPrivateModelAddress(address.address))unsafe();
  }
  // Subsequent socket creation uses ONLY this already checked address:
  // there is no second DNS lookup that can be rebound to 169.254/loopback.
  return addresses[0];
}

export async function assertPublicModelHost(
  baseUrl:string,resolve:Resolver=dnsLookup,
  dockerGatewayIps=process.env.MODEL_DOCKER_GATEWAY_IPS,
):Promise<void>{
  let url:URL;
  try{url=new URL(baseUrl);}catch{invalidUrl();}
  await pinnedModelAddress(url,resolve,dockerGatewayIps);
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
  // The adapter only needs these three headers. In particular, never allow
  // Host, Proxy-Authorization, hop-by-hop or framing overrides: those can
  // redirect credentials or desynchronize intermediary HTTP parsing.
  const allowedHeaders=new Set(['accept','authorization','content-type']);
  new Headers(init?.headers).forEach((value,name)=>{
    if(!allowedHeaders.has(name))throw new Error('MODEL_EGRESS_INVALID_HEADER');
    headers[name]=value;
  });
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
