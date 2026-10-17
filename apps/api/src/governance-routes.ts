import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {getGovernancePulse} from '../../../packages/core/src/governance/pulse.ts';
import {getTenantStructure} from '../../../packages/core/src/governance/structure-query.ts';
import {changeProjectClassification} from '../../../packages/core/src/governance/classification-command.ts';
import {listTenantMembers,listTenantAllocations} from
  '../../../packages/core/src/governance/tenant-queries.ts';
import {createDepartment,createPortfolio,createProgram,addTenantMember,
  changeTenantMemberRole,assignDepartmentMember,cancelTenantAllocation,
  recordTenantAllocation} from '../../../packages/core/src/governance/tenant-commands.ts';

const uuid=z.string().uuid();
const name=z.string().trim().min(1).max(140);
const deny=(code:number,message:string):never=>{
  throw Object.assign(new Error(message),{statusCode:code});
};
export function registerGovernanceRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  const scope=async(req:FastifyRequest)=>{
    const {tenantId:rawTenantId}=req.params as {tenantId:string};
    return {tenantId:uuid.parse(rawTenantId),user:await authenticated(req)};
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
    const {tenantId,user}=await scope(req);
    const v=z.object({idempotencyKey:uuid,name,parentId:uuid.nullable().default(null)}).parse(req.body);
    const department=await createDepartment(tenantId,user,v);
    return reply.code(201).send({department});
  });
  app.post('/tenants/:tenantId/portfolios',async(req,reply)=>{
    const {tenantId,user}=await scope(req);
    const v=z.object({idempotencyKey:uuid,name,description:z.string().max(2000).default('')}).parse(req.body);
    const portfolio=await createPortfolio(tenantId,user,v);
    return reply.code(201).send({portfolio});
  });
  app.post('/tenants/:tenantId/programs',async(req,reply)=>{
    const {tenantId,user}=await scope(req);
    const v=z.object({idempotencyKey:uuid,name,description:z.string().max(2000).default(''),
      portfolioId:uuid.nullable().default(null)}).parse(req.body);
    const program=await createProgram(tenantId,user,v);
    return reply.code(201).send({program});
  });
  app.patch('/tenants/:tenantId/projects/:projectId/classification',async req=>{
    const {tenantId,user}=await scope(req);
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
    const {tenantId,user}=await scope(req);
    return listTenantMembers(tenantId,user);
  });
  app.post('/tenants/:tenantId/members',async req=>{
    const {tenantId,user}=await scope(req);
    const v=z.object({idempotencyKey:uuid,email:z.string().email().transform(x=>x.toLowerCase())}).parse(req.body);
    return addTenantMember(tenantId,user,v);
  });
  app.patch('/tenants/:tenantId/members/:memberId',async req=>{
    const {tenantId,user}=await scope(req);
    const memberId=uuid.parse((req.params as {memberId:string}).memberId);
    const v=z.object({idempotencyKey:uuid,role:z.enum(['admin','member'])}).parse(req.body);
    return changeTenantMemberRole(tenantId,user,memberId,v);
  });
  app.post('/tenants/:tenantId/departments/:departmentId/members',async req=>{
    const {tenantId,user}=await scope(req);
    const departmentId=uuid.parse((req.params as {departmentId:string}).departmentId);
    const v=z.object({idempotencyKey:uuid,userId:uuid,role:z.enum(['lead','member']).default('member')}).parse(req.body);
    return assignDepartmentMember(tenantId,user,departmentId,v);
  });
  app.get('/tenants/:tenantId/allocations',async req=>{
    const {tenantId,user}=await scope(req);
    return listTenantAllocations(tenantId,user);
  });
  app.post('/tenants/:tenantId/allocations/:allocationId/cancel',async req=>{
    const {tenantId,user}=await scope(req);
    const allocationId=uuid.parse((req.params as {allocationId:string}).allocationId);
    const v=z.object({idempotencyKey:uuid}).parse(req.body);
    return cancelTenantAllocation(tenantId,user,allocationId,v);
  });
  app.post('/tenants/:tenantId/allocations',async(req,reply)=>{
    const {tenantId,user}=await scope(req);
    const v=z.object({idempotencyKey:uuid,projectId:uuid,userId:uuid,percentage:z.number().int().min(1).max(100),
      startDate:z.string().date(),endDate:z.string().date()})
      .refine(x=>x.startDate<=x.endDate,'结束日期不得早于开始日期').parse(req.body);
    const allocation=await recordTenantAllocation(tenantId,user,v);
    return reply.code(201).send({allocation});
  });
}
