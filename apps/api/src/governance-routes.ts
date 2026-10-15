import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../../../packages/core/src/db.ts';
import { organizationCommand } from '../../../packages/core/src/organization-commands.ts';
import { recordResourceAllocation } from '../../../packages/core/src/resource-allocation.ts';
import { getGovernancePulse } from '../../../packages/core/src/governance/pulse.ts';
import { getTenantStructure } from '../../../packages/core/src/governance/structure-query.ts';
import { changeProjectClassification } from '../../../packages/core/src/governance/classification-command.ts';
import { requireTenant } from '../../../packages/core/src/permissions.ts';

const uuid=z.string().uuid();
const name=z.string().trim().min(1).max(140);
const deny=(code:number,message:string):never=>{
  throw Object.assign(new Error(message),{statusCode:code});
};
export function registerGovernanceRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  const scope=async(req:FastifyRequest,admin=false)=>{
    const {tenantId:rawTenantId}=req.params as {tenantId:string};
    const tenantId=uuid.parse(rawTenantId),user=await authenticated(req);
    await requireTenant(user,tenantId,admin);
    return {tenantId,user};
  };
  // Tenant-admin only. 'on' selects the planned allocation/deadline date;
  // current task and risk states remain a present-time snapshot, not a replay.
  app.get('/tenants/:tenantId/governance-pulse',async req=>{
    const tenantId=uuid.parse((req.params as {tenantId:string}).tenantId);
    const actorId=await authenticated(req);
    const query=z.object({on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()})
      .strict().parse(req.query);
    const on=query.on??new Date().toISOString().slice(0,10);
    if(Number.isNaN(Date.parse(on+'T00:00:00Z'))||
       new Date(on+'T00:00:00Z').toISOString().slice(0,10)!==on)
      deny(400,'请选择有效的日期');
    return getGovernancePulse(tenantId,actorId,on);
  });
  // Only request shape and identity belong in HTTP; permissions and
  // consistent organization read models live in the core query service.
  app.get('/tenants/:tenantId/structure',async req=>{
    const tenantId=uuid.parse((req.params as {tenantId:string}).tenantId);
    return getTenantStructure(tenantId,await authenticated(req));
  });
  app.post('/tenants/:tenantId/departments',async(req,reply)=>{
    const {tenantId,user}=await scope(req,true);
    const v=z.object({idempotencyKey:uuid,name,parentId:uuid.nullable().default(null)}).parse(req.body);
    const department=await organizationCommand(tenantId,user,'department.created',
      {idempotencyKey:v.idempotencyKey,payload:v},async db=>{
      const {rows}=await db.query(`INSERT INTO departments(tenant_id,name,parent_id)
        VALUES($1,$2,$3) RETURNING id,name,parent_id`,[tenantId,v.name,v.parentId]);
      return {value:rows[0],targetId:rows[0].id,metadata:{parentId:v.parentId}};
    });
    return reply.code(201).send({department});
  });
  app.post('/tenants/:tenantId/portfolios',async(req,reply)=>{
    const {tenantId,user}=await scope(req,true);
    const v=z.object({idempotencyKey:uuid,name,description:z.string().max(2000).default('')}).parse(req.body);
    const portfolio=await organizationCommand(tenantId,user,'portfolio.created',
      {idempotencyKey:v.idempotencyKey,payload:v},async db=>{
      const {rows}=await db.query(`INSERT INTO portfolios(tenant_id,name,description)
        VALUES($1,$2,$3) RETURNING id,name,description`,[tenantId,v.name,v.description]);
      return {value:rows[0],targetId:rows[0].id};
    });
    return reply.code(201).send({portfolio});
  });
  app.post('/tenants/:tenantId/programs',async(req,reply)=>{
    const {tenantId,user}=await scope(req,true);
    const v=z.object({idempotencyKey:uuid,name,description:z.string().max(2000).default(''),
      portfolioId:uuid.nullable().default(null)}).parse(req.body);
    const program=await organizationCommand(tenantId,user,'program.created',
      {idempotencyKey:v.idempotencyKey,payload:v},async db=>{
      const {rows}=await db.query(`INSERT INTO programs(tenant_id,name,description,portfolio_id)
        VALUES($1,$2,$3,$4) RETURNING id,name,description,portfolio_id`,
        [tenantId,v.name,v.description,v.portfolioId]);
      return {value:rows[0],targetId:rows[0].id,metadata:{portfolioId:v.portfolioId}};
    });
    return reply.code(201).send({program});
  });
  app.patch('/tenants/:tenantId/projects/:projectId/classification',async req=>{
    const {tenantId,user}=await scope(req,true);
    const projectId=uuid.parse((req.params as {projectId:string}).projectId);
    const v=z.object({idempotencyKey:uuid,expectedRevision:z.number().int().positive(),
      departmentId:uuid.nullable(),programId:uuid.nullable(),
      portfolioId:uuid.nullable(),
      participatingDepartmentIds:z.array(uuid).max(50)
        .refine(v=>new Set(v).size===v.length,'参与部门不能重复'),
      }).strict().refine(x=>!x.programId||!x.portfolioId,
      '项目属于项目集时，通过项目集汇总到组合')
      .refine(x=>!x.departmentId||
        !x.participatingDepartmentIds.includes(x.departmentId),
        '项目主责部门不能同时列为参与部门').parse(req.body);
    const project=await changeProjectClassification(tenantId,user,projectId,v);
    return {project};
  });
  app.get('/tenants/:tenantId/members',async req=>{
    const {tenantId}=await scope(req,true);
    const {rows}=await pool.query(`SELECT u.id,u.display_name,u.email,tm.role
      FROM tenant_members tm JOIN users u ON u.id=tm.user_id
      WHERE tm.tenant_id=$1 ORDER BY u.display_name`,[tenantId]);
    return {members:rows};
  });
  app.post('/tenants/:tenantId/members',async req=>{
    const {tenantId,user}=await scope(req,true);
    const v=z.object({idempotencyKey:uuid,email:z.string().email().transform(x=>x.toLowerCase())}).parse(req.body);
    return organizationCommand(tenantId,user,'tenant.member_added',
      {idempotencyKey:v.idempotencyKey,payload:v},async db=>{
      const found=await db.query('SELECT id FROM users WHERE email=$1',[v.email]);
      if(!found.rowCount)deny(404,'请先为该人员签发组织邀请码，待其接受邀请后再管理组织成员');
      const memberId=found.rows[0].id as string;
      const inserted=await db.query(`INSERT INTO tenant_members(tenant_id,user_id,role)
        VALUES($1,$2,'member') ON CONFLICT DO NOTHING RETURNING user_id`,[tenantId,memberId]);
      if(!inserted.rowCount)deny(409,'该人员已加入当前组织');
      return {value:{ok:true},targetId:memberId,metadata:{created:true}};
    });
  });
  app.patch('/tenants/:tenantId/members/:memberId',async req=>{
    // Current tenant membership suffices to replay the actor's *completed*
    // demotion receipt. New commands still require admin inside the transaction.
    const {tenantId,user}=await scope(req);
    const memberId=uuid.parse((req.params as {memberId:string}).memberId);
    const v=z.object({idempotencyKey:uuid,role:z.enum(['admin','member'])}).parse(req.body);
    const {role}=v;
    return organizationCommand(tenantId,user,'tenant.member_role_changed',
      {idempotencyKey:v.idempotencyKey,payload:{memberId,...v}},async db=>{
      const target=(await db.query<{role:string}>(`
        SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2
        FOR UPDATE`,[tenantId,memberId])).rows[0];
      if(!target)deny(404,'人员不属于该组织');
      if(target.role===role)deny(409,'该人员已经是目标组织角色');
      if(role==='member'){
        const admins=await db.query(`SELECT user_id FROM tenant_members
          WHERE tenant_id=$1 AND role='admin' FOR UPDATE`,[tenantId]);
        if(admins.rows.length===1&&admins.rows[0].user_id===memberId)
          deny(409,'组织至少保留一位管理员');
      }
      const {rows}=await db.query(`UPDATE tenant_members SET role=$3
        WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id,role`,[tenantId,memberId,role]);
      if(!rows.length)deny(404,'人员不属于该组织');
      return {value:{member:rows[0]},targetId:memberId,
        metadata:{previousRole:target.role,newRole:role}};
    },{replayAccess:'member'});
  });
  app.post('/tenants/:tenantId/departments/:departmentId/members',async req=>{
    const {tenantId,user}=await scope(req,true);
    const departmentId=uuid.parse((req.params as {departmentId:string}).departmentId);
    const v=z.object({idempotencyKey:uuid,userId:uuid,role:z.enum(['lead','member']).default('member')}).parse(req.body);
    return organizationCommand(tenantId,user,'department.member_assigned',
      {idempotencyKey:v.idempotencyKey,payload:v},async db=>{
      const {rows}=await db.query(`INSERT INTO department_members
        (tenant_id,department_id,user_id,role) VALUES($1,$2,$3,$4)
        ON CONFLICT(department_id,user_id) DO UPDATE SET role=EXCLUDED.role
          WHERE department_members.role IS DISTINCT FROM EXCLUDED.role
        RETURNING department_id,user_id,role`,[tenantId,departmentId,v.userId,v.role]);
      if(!rows.length)deny(409,'该人员已经拥有目标部门角色');
      return {value:{member:rows[0]},targetId:v.userId,
        metadata:{departmentId,role:v.role}};
    });
  });
  app.get('/tenants/:tenantId/allocations',async req=>{
    const {tenantId}=await scope(req,true);
    const {rows}=await pool.query(`SELECT a.id,a.project_id,a.user_id,a.percentage,
      a.start_date::text AS start_date,a.end_date::text AS end_date,
       a.cancelled_at,a.cancelled_by
      FROM resource_allocations a WHERE tenant_id=$1 ORDER BY start_date DESC LIMIT 500`,[tenantId]);
    return {allocations:rows};
  });
  app.post('/tenants/:tenantId/allocations/:allocationId/cancel',async req=>{
    const {tenantId,user}=await scope(req,true);
    const allocationId=uuid.parse((req.params as {allocationId:string}).allocationId);
    const v=z.object({idempotencyKey:uuid}).parse(req.body);
    return organizationCommand(tenantId,user,'allocation.cancelled',
      {idempotencyKey:v.idempotencyKey,payload:{allocationId}},async db=>{
        const cancelled=await db.query<{
          id:string;project_id:string;user_id:string;
        }>(`UPDATE resource_allocations SET cancelled_at=NOW(),cancelled_by=$3
          WHERE tenant_id=$1 AND id=$2 AND cancelled_at IS NULL
          RETURNING id,project_id,user_id`,[tenantId,allocationId,user]);
        const record=cancelled.rows[0];
        if(!record)deny(409,'资源分配不存在或已经取消');
        return {value:{ok:true,allocationId},targetId:allocationId,
          metadata:{projectId:record.project_id,userId:record.user_id}};
      });
  });
  app.post('/tenants/:tenantId/allocations',async(req,reply)=>{
    const {tenantId,user}=await scope(req,true);
    const v=z.object({idempotencyKey:uuid,projectId:uuid,userId:uuid,percentage:z.number().int().min(1).max(100),
      startDate:z.string().date(),endDate:z.string().date()})
      .refine(x=>x.startDate<=x.endDate,'结束日期不得早于开始日期').parse(req.body);
    const allocation=await organizationCommand(tenantId,user,'allocation.recorded',
      {idempotencyKey:v.idempotencyKey,payload:v},async db=>{
      const allocation=await recordResourceAllocation(db,{
        tenantId,projectId:v.projectId,userId:v.userId,percentage:v.percentage,
        startDate:v.startDate,endDate:v.endDate,
      });
      return {value:allocation,targetId:allocation.id,
        metadata:{projectId:v.projectId,userId:v.userId,percentage:v.percentage,
          startDate:v.startDate,endDate:v.endDate}};
    });
    return reply.code(201).send({allocation});
  });
}
