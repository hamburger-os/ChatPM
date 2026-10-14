import { jwtVerify } from 'jose';

/**
 * Fastify sees the Next.js server as its network peer. Distinguish valid signed
 * sessions for application quotas without trusting caller-supplied cookie text.
 * This is not authentication: protected routes still check the DB session.
 */
export async function signedQuotaKey(
  request:{ip:string;url:string;cookies?:{chatpm_session?:string}},
  secret:string,
):Promise<string>{
  const byIp='ip:'+request.ip;
  if(request.url==='/auth'||request.url.startsWith('/auth/'))return byIp;
  const token=request.cookies?.chatpm_session;
  if(!token)return byIp;
  try{
    const verified=await jwtVerify(token,new TextEncoder().encode(secret),
      {algorithms:['HS256']});
    return typeof verified.payload.sub==='string'&&verified.payload.sub.length>0
      ?'user:'+verified.payload.sub:byIp;
  }catch{return byIp;}
}
