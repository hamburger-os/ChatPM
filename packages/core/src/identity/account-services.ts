import {pool,transaction} from '../db.ts';
import {serverConfig} from '../config.ts';
import {hashPassword,verifyPassword} from '../security.ts';
import {enforceRegistration,mayRegister} from './registration-policy.ts';

type Account={id:string;email:string;display_name:string};
type RegistrationInput={
  email:string;displayName:string;password:string;bootstrapToken?:string;
};

function unauthenticated():never{
  throw Object.assign(new Error('账号或密码错误'),{statusCode:401});
}

/** Public registration availability is a live read of the one installation
 * policy and current users table, never a cached HTTP assumption.
 */
export async function getRegistrationStatus(){
  const mode=serverConfig.REGISTRATION_MODE;
  const hasUsers=mode==='bootstrap'
    ?Boolean((await pool.query('SELECT 1 FROM users LIMIT 1')).rowCount):false;
  return {
    allowed:mayRegister(mode,hasUsers)&&
      (mode!=='bootstrap'||Boolean(serverConfig.BOOTSTRAP_TOKEN)),
    requiresBootstrapToken:mode==='bootstrap',
  };
}

/** Account, owner tenant and membership are created atomically. The bootstrap
 * advisory lock inside enforceRegistration serializes the FIRST user race.
 * No command cache, compatibility path or shadow identity store.
 */
export function registerAccount(input:RegistrationInput):Promise<Account>{
  return transaction(async db=>{
    await enforceRegistration(db,serverConfig.REGISTRATION_MODE,
      input.bootstrapToken,serverConfig.BOOTSTRAP_TOKEN);
    const {rows}=await db.query<Account>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,$3) RETURNING id,email,display_name
    `,[input.email,input.displayName,hashPassword(input.password)]);
    const created=rows[0];
    const tenant=await db.query<{id:string}>(`
      INSERT INTO tenants(name) VALUES($1) RETURNING id
    `,[input.displayName+' 的团队']);
    await db.query(`
      INSERT INTO tenant_members(tenant_id,user_id,role)
      VALUES($1,$2,'admin')
    `,[tenant.rows[0].id,created.id]);
    return created;
  });
}

export async function authenticateAccount(
  email:string,password:string,
):Promise<Account>{
  const {rows}=await pool.query<Account&{password_hash:string}>(`
    SELECT id,email,display_name,password_hash FROM users WHERE email=$1
  `,[email]);
  const user=rows[0];
  if(!user||!verifyPassword(password,user.password_hash))
    unauthenticated();
  return {id:user.id,email:user.email,display_name:user.display_name};
}

/** Session identity has already been verified by the HTTP entrypoint. */
export async function getAccountProfile(userId:string){
  const {rows}=await pool.query<Account&{is_system_admin:boolean}>(`
    SELECT id,email,display_name,is_system_admin FROM users WHERE id=$1
  `,[userId]);
  if(!rows[0])throw Object.assign(new Error('请先登录'),{statusCode:401});
  return {user:rows[0]};
}

export async function listAccountTenants(userId:string){
  const {rows}=await pool.query<{
    id:string;name:string;role:'admin'|'member';
  }>(`
    SELECT t.id,t.name,tm.role FROM tenants t
    JOIN tenant_members tm ON tm.tenant_id=t.id
    WHERE tm.user_id=$1 ORDER BY t.name,t.id
  `,[userId]);
  return {tenants:rows};
}
