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
