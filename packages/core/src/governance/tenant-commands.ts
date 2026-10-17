import {organizationCommand} from '../organization-commands.ts';
import {recordResourceAllocation} from '../resource-allocation.ts';

type Key={idempotencyKey:string};
type CreateDepartment=Key&{name:string;parentId:string|null};
type CreatePortfolio=Key&{name:string;description:string};
type CreateProgram=Key&{name:string;description:string;portfolioId:string|null};
type AddMember=Key&{email:string};
type RoleChange=Key&{role:'admin'|'member'};
type DepartmentMember=Key&{userId:string;role:'lead'|'member'};
type Allocation=Key&{
  projectId:string;userId:string;percentage:number;
  startDate:string;endDate:string;
};

function deny(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}

/** One tenant-scoped CommandReceipt, administrative lock and audit for each
 * change. The HTTP API owns only identity and DTO shape, never business SQL.
 */
export function createDepartment(tenantId:string,actorId:string,value:CreateDepartment){
  return organizationCommand(tenantId,actorId,'department.created',
    {idempotencyKey:value.idempotencyKey,payload:value},async db=>{
      const {rows}=await db.query<{id:string;name:string;parent_id:string|null}>(`
        INSERT INTO departments(tenant_id,name,parent_id)
        VALUES($1,$2,$3) RETURNING id,name,parent_id
      `,[tenantId,value.name,value.parentId]);
      return {value:rows[0],targetId:rows[0].id,
        metadata:{parentId:value.parentId}};
    });
}

export function createPortfolio(tenantId:string,actorId:string,value:CreatePortfolio){
  return organizationCommand(tenantId,actorId,'portfolio.created',
    {idempotencyKey:value.idempotencyKey,payload:value},async db=>{
      const {rows}=await db.query<{id:string;name:string;description:string}>(`
        INSERT INTO portfolios(tenant_id,name,description)
        VALUES($1,$2,$3) RETURNING id,name,description
      `,[tenantId,value.name,value.description]);
      return {value:rows[0],targetId:rows[0].id};
    });
}

export function createProgram(tenantId:string,actorId:string,value:CreateProgram){
  return organizationCommand(tenantId,actorId,'program.created',
    {idempotencyKey:value.idempotencyKey,payload:value},async db=>{
      const {rows}=await db.query<{
        id:string;name:string;description:string;portfolio_id:string|null;
      }>(`
        INSERT INTO programs(tenant_id,name,description,portfolio_id)
        VALUES($1,$2,$3,$4) RETURNING id,name,description,portfolio_id
      `,[tenantId,value.name,value.description,value.portfolioId]);
      return {value:rows[0],targetId:rows[0].id,
        metadata:{portfolioId:value.portfolioId}};
    });
}

export function addTenantMember(tenantId:string,actorId:string,value:AddMember){
  return organizationCommand(tenantId,actorId,'tenant.member_added',
    {idempotencyKey:value.idempotencyKey,payload:value},async db=>{
      const found=await db.query<{id:string}>('SELECT id FROM users WHERE email=$1',
        [value.email]);
      if(!found.rowCount)
        deny(404,'请先为该人员签发组织邀请码，待其接受邀请后再管理组织成员');
      const memberId=found.rows[0].id;
      const inserted=await db.query(`
        INSERT INTO tenant_members(tenant_id,user_id,role)
        VALUES($1,$2,'member') ON CONFLICT DO NOTHING RETURNING user_id
      `,[tenantId,memberId]);
      if(!inserted.rowCount)deny(409,'该人员已加入当前组织');
      return {value:{ok:true},targetId:memberId,metadata:{created:true}};
    });
}

export function changeTenantMemberRole(
  tenantId:string,actorId:string,memberId:string,value:RoleChange,
){
  return organizationCommand(tenantId,actorId,'tenant.member_role_changed',
    {idempotencyKey:value.idempotencyKey,payload:{memberId,...value}},async db=>{
      const target=(await db.query<{role:string}>(`
        SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2
        FOR UPDATE
      `,[tenantId,memberId])).rows[0];
      if(!target)deny(404,'人员不属于该组织');
      if(target.role===value.role)deny(409,'该人员已经是目标组织角色');
      if(value.role==='member'){
        const admins=await db.query<{user_id:string}>(`
          SELECT user_id FROM tenant_members
          WHERE tenant_id=$1 AND role='admin' FOR UPDATE
        `,[tenantId]);
        if(admins.rows.length===1&&admins.rows[0].user_id===memberId)
          deny(409,'组织至少保留一位管理员');
      }
      const {rows}=await db.query<{user_id:string;role:string}>(`
        UPDATE tenant_members SET role=$3
        WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id,role
      `,[tenantId,memberId,value.role]);
      if(!rows.length)deny(404,'人员不属于该组织');
      return {value:{member:rows[0]},targetId:memberId,
        metadata:{previousRole:target.role,newRole:value.role}};
    },{replayAccess:'member'});
}

export function assignDepartmentMember(
  tenantId:string,actorId:string,departmentId:string,value:DepartmentMember,
){
  return organizationCommand(tenantId,actorId,'department.member_assigned',
    {idempotencyKey:value.idempotencyKey,payload:value},async db=>{
      const {rows}=await db.query<{
        department_id:string;user_id:string;role:string;
      }>(`
        INSERT INTO department_members(tenant_id,department_id,user_id,role)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(department_id,user_id) DO UPDATE SET role=EXCLUDED.role
          WHERE department_members.role IS DISTINCT FROM EXCLUDED.role
        RETURNING department_id,user_id,role
      `,[tenantId,departmentId,value.userId,value.role]);
      if(!rows.length)deny(409,'该人员已经拥有目标部门角色');
      return {value:{member:rows[0]},targetId:value.userId,
        metadata:{departmentId,role:value.role}};
    });
}

export function cancelTenantAllocation(
  tenantId:string,actorId:string,allocationId:string,value:Key,
){
  return organizationCommand(tenantId,actorId,'allocation.cancelled',
    {idempotencyKey:value.idempotencyKey,payload:{allocationId}},async db=>{
      const cancelled=await db.query<{
        id:string;project_id:string;user_id:string;
      }>(`
        UPDATE resource_allocations SET cancelled_at=NOW(),cancelled_by=$3
        WHERE tenant_id=$1 AND id=$2 AND cancelled_at IS NULL
        RETURNING id,project_id,user_id
      `,[tenantId,allocationId,actorId]);
      const record=cancelled.rows[0];
      if(!record)deny(409,'资源分配不存在或已经取消');
      return {value:{ok:true,allocationId},targetId:allocationId,
        metadata:{projectId:record.project_id,userId:record.user_id}};
    });
}

export function recordTenantAllocation(
  tenantId:string,actorId:string,value:Allocation,
){
  return organizationCommand(tenantId,actorId,'allocation.recorded',
    {idempotencyKey:value.idempotencyKey,payload:value},async db=>{
      const allocation=await recordResourceAllocation(db,{
        tenantId,projectId:value.projectId,userId:value.userId,
        percentage:value.percentage,startDate:value.startDate,endDate:value.endDate,
      });
      return {value:allocation,targetId:allocation.id,
        metadata:{projectId:value.projectId,userId:value.userId,
          percentage:value.percentage,startDate:value.startDate,endDate:value.endDate}};
    });
}
