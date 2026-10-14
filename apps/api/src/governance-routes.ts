import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, transaction } from '../../../packages/core/src/db.ts';
import { requireTenant } from '../../../packages/core/src/permissions.ts';

const uuid=z.string().uuid();
const name=z.string().trim().min(1).max(140);
const deny=(code:number,message:string):never=>{
  throw Object.assign(new Error(message),{statusCode:code});
};
export function registerGovernanceRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  const scope=async(req:FastifyRequest,admin=false)=>{
    const {tenantId}=req.params as {tenantId:string};
    const tenantId=uuid.parse(tenantId),user=await authenticated(req);
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
      pool.query(`SELECT id,name,department_id,program_id,portfolio_id FROM projects
        WHERE tenant_id=$1 ORDER BY name`,[tenantId]),
    ]);
    // Only return project classification for projects explicitly visible to this member.
    const user=await authenticated(req);
    const visible=await pool.query(`SELECT p.id,p.name,p.department_id,p.program_id,p.portfolio_id
      FROM projects p JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
      WHERE p.tenant_id=$1 ORDER BY p.name`,[tenantId,user]);
    return {departments:departments.rows,portfolios:portfolios.rows,
      programs:programs.rows,projects:visible.rows};
  });
  app.post('/tenants/:tenantId/departments',async(req,reply)=>{
    const {tenantId}=await scope(req,true);
    const v=z.object({name,parentId:uuid.nullable().default(null)}).parse(req.body);
    const {rows}=await pool.query(`INSERT INTO departments(tenant_id,name,parent_id)
      VALUES($1,$2,$3) RETURNING id,name,parent_id`,[tenantId,v.name,v.parentId]);
    return reply.code(201).send({department:rows[0]});
  });
  app.post('/tenants/:tenantId/portfolios',async(req,reply)=>{
    const {tenantId}=await scope(req,true);
    const v=z.object({name,description:z.string().max(2000).default('')}).parse(req.body);
    const {rows}=await pool.query(`INSERT INTO portfolios(tenant_id,name,description)
      VALUES($1,$2,$3) RETURNING id,name,description`,[tenantId,v.name,v.description]);
    return reply.code(201).send({portfolio:rows[0]});
  });
  app.post('/tenants/:tenantId/programs',async(req,reply)=>{
    const {tenantId}=await scope(req,true);
    const v=z.object({name,description:z.string().max(2000).default(''),
      portfolioId:uuid.nullable().default(null)}).parse(req.body);
    const {rows}=await pool.query(`INSERT INTO programs(tenant_id,name,description,portfolio_id)
      VALUES($1,$2,$3,$4) RETURNING id,name,description,portfolio_id`,
      [tenantId,v.name,v.description,v.portfolioId]);
    return reply.code(201).send({program:rows[0]});
  });
  app.patch('/tenants/:tenantId/projects/:projectId/classification',async req=>{
    const {tenantId}=await scope(req,true);
    const projectId=uuid.parse((req.params as {projectId:string}).projectId);
    const v=z.object({departmentId:uuid.nullable(),programId:uuid.nullable(),
      portfolioId:uuid.nullable()}).refine(x=>!x.programId||!x.portfolioId,
      '项目属于项目集时，通过项目集汇总到组合').parse(req.body);
    const {rows}=await pool.query(`UPDATE projects SET department_id=$3,program_id=$4,
      portfolio_id=$5 WHERE tenant_id=$1 AND id=$2
      RETURNING id,department_id,program_id,portfolio_id`,
      [tenantId,projectId,v.departmentId,v.programId,v.portfolioId]);
    if(!rows.length)deny(404,'项目不存在');
    return {project:rows[0]};
  });
  app.get('/tenants/:tenantId/members',async req=>{
    const {tenantId}=await scope(req,true);
    const {rows}=await pool.query(`SELECT u.id,u.display_name,u.email,tm.role
      FROM tenant_members tm JOIN users u ON u.id=tm.user_id
      WHERE tm.tenant_id=$1 ORDER BY u.display_name`,[tenantId]);
    return {members:rows};
  });
  app.post('/tenants/:tenantId/members',async req=>{
    const {tenantId}=await scope(req,true);
    const v=z.object({email:z.string().email().transform(x=>x.toLowerCase())}).parse(req.body);
    const found=await pool.query('SELECT id FROM users WHERE email=$1',[v.email]);
    if(!found.rowCount)deny(404,'请先让该人员注册账号（邀请机制仍在规划中）');
    await pool.query(`INSERT INTO tenant_members(tenant_id,user_id,role)
      VALUES($1,$2,'member') ON CONFLICT DO NOTHING`,[tenantId,found.rows[0].id]);
    return {ok:true};
  });
  app.patch('/tenants/:tenantId/members/:memberId',async req=>{
    const {tenantId,user}=await scope(req,true);
    const memberId=uuid.parse((req.params as {memberId:string}).memberId);
    const {role}=z.object({role:z.enum(['admin','member'])}).parse(req.body);
    return transaction(async db=>{
      // Serialize changes to tenant admins; never leave a tenant without an admin.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        ['tenant-admin:'+tenantId]);
      if(role==='member'){
        const admins=await db.query(`SELECT user_id FROM tenant_members
          WHERE tenant_id=$1 AND role='admin' FOR UPDATE`,[tenantId]);
        if(admins.rows.length===1&&admins.rows[0].user_id===memberId)
          deny(409,'组织至少保留一位管理员');
      }
      const {rows}=await db.query(`UPDATE tenant_members SET role=$3
        WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id,role`,[tenantId,memberId,role]);
      if(!rows.length)deny(404,'人员不属于该组织');
      await db.query(`INSERT INTO organization_audit_entries
        (tenant_id,actor_id,action,target_id,metadata)
        VALUES($1,$2,'tenant.member_role_changed',$3,$4)`,
        [tenantId,user,memberId,JSON.stringify({role})]);
      return {member:rows[0]};
    });
  });
  app.post('/tenants/:tenantId/departments/:departmentId/members',async req=>{
    const {tenantId,user}=await scope(req,true);
    const departmentId=uuid.parse((req.params as {departmentId:string}).departmentId);
    const v=z.object({userId:uuid,role:z.enum(['lead','member']).default('member')}).parse(req.body);
    const {rows}=await pool.query(`INSERT INTO department_members
      (tenant_id,department_id,user_id,role) VALUES($1,$2,$3,$4)
      ON CONFLICT(department_id,user_id) DO UPDATE SET role=EXCLUDED.role
      RETURNING department_id,user_id,role`,[tenantId,departmentId,v.userId,v.role]);
    await pool.query(`INSERT INTO organization_audit_entries
      (tenant_id,actor_id,action,target_id,metadata)
      VALUES($1,$2,'department.member_assigned',$3,$4)`,
      [tenantId,user,v.userId,JSON.stringify({departmentId,role:v.role})]);
    return {member:rows[0]};
  });
  app.get('/tenants/:tenantId/allocations',async req=>{
    const {tenantId}=await scope(req,true);
    const {rows}=await pool.query(`SELECT a.id,a.project_id,a.user_id,a.percentage,
      a.start_date::text AS start_date,a.end_date::text AS end_date
      FROM resource_allocations a WHERE tenant_id=$1 ORDER BY start_date DESC LIMIT 500`,[tenantId]);
    return {allocations:rows};
  });
  app.post('/tenants/:tenantId/allocations',async(req,reply)=>{
    const {tenantId}=await scope(req,true);
    const v=z.object({projectId:uuid,userId:uuid,percentage:z.number().int().min(1).max(100),
      startDate:z.string().date(),endDate:z.string().date()})
      .refine(x=>x.startDate<=x.endDate,'结束日期不得早于开始日期').parse(req.body);
    const {rows}=await pool.query(`INSERT INTO resource_allocations
      (tenant_id,project_id,user_id,percentage,start_date,end_date)
      SELECT p.tenant_id,p.id,pm.user_id,$4,$5,$6
      FROM projects p JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$3
      WHERE p.tenant_id=$1 AND p.id=$2 RETURNING id`,
      [tenantId,v.projectId,v.userId,v.percentage,v.startDate,v.endDate]);
    if(!rows.length)deny(400,'资源只能分配给本组织内已加入该项目的成员');
    return reply.code(201).send({allocation:{id:rows[0].id}});
  });
}
