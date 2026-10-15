import type {DbClient} from '../db.ts';
import {createHash,timingSafeEqual} from 'node:crypto';

export type RegistrationMode='open'|'bootstrap'|'closed';
export function configuredRegistrationMode(
  environment:'development'|'test'|'production',configured?:RegistrationMode,
):RegistrationMode{
  return configured??(environment==='production'?'bootstrap':'open');
}

/** Only an explicit operator opt-in allows unrestricted public sign-up. */
export function mayRegister(mode:RegistrationMode,hasUsers:boolean):boolean{
  return mode==='open'||(mode==='bootstrap'&&!hasUsers);
}
function deny():never{
  throw Object.assign(new Error('公开注册已关闭，请联系系统管理员'),{statusCode:403});
}

/** Hold a database transaction lock while creating the very first account.
 * Concurrent anonymous bootstrap requests cannot each create an admin tenant. */
export function verifyBootstrapToken(provided:unknown,expected:unknown):boolean{
  if(typeof provided!=='string'||!(/^[a-f0-9]{64}$/i.test(provided))||
     typeof expected!=='string'||!(/^[a-f0-9]{64}$/i.test(expected)))return false;
  const a=createHash('sha256').update(provided.toLowerCase()).digest();
  const b=createHash('sha256').update(expected.toLowerCase()).digest();
  return timingSafeEqual(a,b);
}
export async function enforceRegistration(
  db:DbClient,mode:RegistrationMode,
  providedToken?:unknown,configuredToken?:string,
):Promise<void>{
  if(mode==='closed')deny();
  if(mode==='open')return;
  await db.query('SELECT pg_advisory_xact_lock(21844,7303)');
  const found=await db.query('SELECT 1 FROM users LIMIT 1');
  if(found.rowCount||!verifyBootstrapToken(providedToken,configuredToken))deny();
}
