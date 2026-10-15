import { jwtVerify } from 'jose';
import { createHmac } from 'node:crypto';

/**
 * Fastify sees the Next.js server as its network peer. Distinguish valid signed
 * sessions for application quotas without trusting caller-supplied cookie text.
 * This is not authentication: protected routes still check the DB session.
 */
export async function signedQuotaKey(
  request:{ip:string;url:string;cookies?:{chatpm_session?:string};body?:unknown},
  secret:string,
):Promise<string>{
  const byIp='ip:'+request.ip;
  // Behind Next.js, request.ip is the shared proxy IP. At preHandler, the
  // validated JSON body is available: scope login/registration quotas by the
  // normalized account identifier instead of locking out unrelated users.
  // HMAC keeps email addresses out of rate-limit storage and metrics.
  if(request.url==='/auth/login'||request.url==='/auth/register'||
     request.url==='/auth/invitations/claim'){
    const body=request.body;
    const email=body&&typeof body==='object'&&'email' in body
      ? (body as {email?:unknown}).email:null;
    if(typeof email==='string'&&email.length<=200){
      const normalized=email.trim().toLowerCase();
      if(normalized) return 'auth:'+request.url+':'+
        createHmac('sha256',secret).update(normalized).digest('hex');
    }
    return byIp;
  }
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
