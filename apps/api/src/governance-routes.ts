import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../../../packages/core/src/db.ts';
import { organizationCommand } from '../../../packages/core/src/organization-commands.ts';
import { recordResourceAllocation } from '../../../packages/core/src/resource-allocation.ts';
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
  // Department, program and portfolio are separate organizational dimensions.
  app.get('/tenants/:tenantId/structure',async req=>{
    const {tenantId}=await scope(req);
    const [departments,portfolios,programs]=await Promise.all([
      pool.query('SELECT id,name,parent_id FROM departments WHERE tenant_id=$1 ORDER BY name',[tenantId]),
      pool.query('SELECT id,name,description FROM portfolios WHERE tenant_id=$1 ORDER BY name',[tenantId]),
      pool.query('SELECT id,name,description,portfolio_id FROM programs WHERE tenant_id=$1 ORDER BY name',[tenantId]),
    ]);
    // Only return project classification for projects explicitly visible to this member.
    const user=await authenticated(req);
    const member=await pool.query('SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
      [tenantId,user]);
    const visible=member.rows[0]?.role==='admin'
      ?await pool.query(`SELECT id,name,department_id,program_id,portfolio_id,classification_revision
        FROM projects WHERE tenant_id=$1 ORDER BY name`,[tenantId])
      :await pool.query(`SELECT p.id,p.name,p.department_id,p.program_id,p.portfolio_id,
          p.classification_revision FROM projects p JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
        WHERE p.tenant_id=$1 ORDER BY p.name`,[tenantId,user]);
    return {departments:departments.rows,portfolios:portfolios.rows,
      programs:programs.rows,projects:visible.rows};
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
      portfolioId:uuid.nullable()}).refine(x=>!x.programId||!x.portfolioId,
      '项目属于项目集时，通过项目集汇总到组合').parse(req.body);
    const project=await organizationCommand(tenantId,user,'project.classification_changed',
      {idempotencyKey:v.idempotencyKey,payload:v},async db=>{
      const before=(await db.query<{
        classification_revision:number;department_id:string|null;
        program_id:string|null;portfolio_id:string|null;
      }>(`SELECT classification_revision,department_id,program_id,portfolio_id
        FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId,projectId])).rows[0];
      if(!before)deny(404,'项目不存在');
      if(before.classification_revision!==v.expectedRevision)
        deny(409,'项目归属已被修改，请刷新后重新确认');
      if(before.department_id===v.departmentId&&
         before.program_id===v.programId&&
         before.portfolio_id===v.portfolioId)
        deny(409,'项目已采用该归属，不需要重复修改');
      const updated=await db.query(`
        UPDATE projects SET department_id=$3,program_id=$4,
          portfolio_id=$5,classification_revision=classification_revision+1
        WHERE tenant_id=$1 AND id=$2 AND classification_revision=$6
        RETURNING id,department_id,program_id,portfolio_id,classification_revision
      `,[tenantId,projectId,v.departmentId,v.programId,v.portfolioId,v.expectedRevision]);
      if(!updated.rowCount)deny(409,'项目归属版本冲突');
      return {value:updated.rows[0],targetId:projectId,
        metadata:{previousRevision:before.classification_revision,
          classificationRevision:updated.rows[0].classification_revision,
          departmentId:v.departmentId,programId:v.programId,portfolioId:v.portfolioId}};
    });
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
      if(!found.rowCount)deny(404,'请先让该人员注册账号（邀请机制仍在规划中）');
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
