import { transaction, type DbClient } from '../db.ts';

/**
 * System privileges are verified under a row lock in the SAME transaction as
 * credential/model changes and system audit. Revocation cannot commit between
 * a stale route precheck and the protected mutation.
 */
export async function systemAdminTransaction<T>(
  actorId:string,mutate:(db:DbClient)=>Promise<T>,
):Promise<T>{
  return transaction(async db=>{
    const {rows}=await db.query<{is_system_admin:boolean}>(
      'SELECT is_system_admin FROM users WHERE id=$1 FOR SHARE',[actorId]);
    if(rows[0]?.is_system_admin!==true)
      throw Object.assign(new Error('仅系统总管理员可以执行此操作'),{statusCode:403});
    return mutate(db);
  });
}
