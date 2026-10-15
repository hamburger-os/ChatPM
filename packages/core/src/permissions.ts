import { pool } from './db.ts';

export type ProjectRole='owner'|'manager'|'member'|'observer';
export type ProjectAction='read'|'message.write'|'task.create'|'task.plan'|
  'task.status'|'proposal.approve'|'report.manage'|'members.manage'|
  'settings.manage'|'operations.manage'|'pm.plan'|'pm.submit'|'pm.accept'|'pm.approve';

const grants:Record<ProjectRole,ReadonlySet<ProjectAction>>={
  owner:new Set(['read','message.write','task.create','task.plan','task.status',
    'proposal.approve','report.manage','members.manage','settings.manage','operations.manage',
    'pm.plan','pm.submit','pm.accept','pm.approve']),
  manager:new Set(['read','message.write','task.create','task.plan','task.status',
    'proposal.approve','pm.plan','pm.submit','pm.accept','pm.approve']),
  member:new Set(['read','message.write','task.status','pm.submit']),
  observer:new Set(['read']),
};

export function canProject(role:ProjectRole,action:ProjectAction,
  options:{isAssignee?:boolean}={}):boolean{
  if(!grants[role]?.has(action))return false;
  return (action!=='task.status' && action!=='pm.submit')||
    role==='owner'||role==='manager'||options.isAssignee===true;
}
export function assertProject(role:ProjectRole,action:ProjectAction,
  options:{isAssignee?:boolean}={}):void{
  if(!canProject(role,action,options))
    throw Object.assign(new Error('没有执行该操作的权限'),{statusCode:403});
}
export async function isSystemAdmin(userId:string):Promise<boolean>{
  const {rows}=await pool.query('SELECT is_system_admin FROM users WHERE id=$1',[userId]);
  return rows[0]?.is_system_admin===true;
}
export async function requireSystemAdmin(userId:string):Promise<void>{
  if(!await isSystemAdmin(userId))
    throw Object.assign(new Error('仅系统总管理员可以执行此操作'),{statusCode:403});
}
export async function requireTenant(userId:string,tenantId:string,admin=false):Promise<void>{
  const {rows}=await pool.query('SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
    [tenantId,userId]);
  if(!rows[0] || (admin&&rows[0].role!=='admin'))
    throw Object.assign(new Error('没有该组织的访问权限'),{statusCode:403});
}
