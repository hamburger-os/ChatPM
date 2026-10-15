import type {DbClient} from '../db.ts';

export type RegistrationMode='open'|'bootstrap'|'closed';

/** Only an explicit operator opt-in allows unrestricted public sign-up. */
export function mayRegister(mode:RegistrationMode,hasUsers:boolean):boolean{
  return mode==='open'||(mode==='bootstrap'&&!hasUsers);
}
function deny():never{
  throw Object.assign(new Error('公开注册已关闭，请联系系统管理员'),{statusCode:403});
}

/** Hold a database transaction lock while creating the very first account.
 * Concurrent anonymous bootstrap requests cannot each create an admin tenant. */
export async function enforceRegistration(db:DbClient,mode:RegistrationMode):Promise<void>{
  if(mode==='closed')deny();
  if(mode==='open')return;
  await db.query('SELECT pg_advisory_xact_lock(21844,7303)');
  const found=await db.query('SELECT 1 FROM users LIMIT 1');
  if(found.rowCount)deny();
}
