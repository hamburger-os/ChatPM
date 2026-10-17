import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {createProjectCommand} from '../src/project-creation.ts';
import {
  createDepartment,createPortfolio,createProgram,addTenantMember,
  changeTenantMemberRole,assignDepartmentMember,cancelTenantAllocation,
  recordTenantAllocation,
} from '../src/governance/tenant-commands.ts';
import {listTenantMembers,listTenantAllocations} from
  '../src/governance/tenant-queries.ts';

const seed=randomUUID();
const projects:string[]=[];
try{
  async function newUser(name:string){
    const {rows}=await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,
      [name+'-'+seed+'@example.test',name]);
    return rows[0].id;
  }
  const admin=await newUser('tenant-owner');
  const admin2=await newUser('tenant-admin2');
  const candidate=await newUser('tenant-candidate');
  const outsider=await newUser('tenant-outsider');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Tenant command scope') RETURNING id
  `)).rows[0].id;
  const foreign=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Tenant unrelated') RETURNING id
  `)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'admin'),($4,$5,'admin')
  `,[tenant,admin,admin2,foreign,outsider]);

  const depKey={idempotencyKey:randomUUID(),name:'Software',
    parentId:null};
  const dep=await createDepartment(tenant,admin,depKey);
  assert.equal(dep.name,'Software');
  assert.deepEqual(await createDepartment(tenant,admin,depKey),dep);
  await assert.rejects(createDepartment(tenant,admin,
    {...depKey,name:'Changed'}),/幂等键已经用于其他组织命令/);
  await assert.rejects(createDepartment(foreign,admin,
    {...depKey,idempotencyKey:randomUUID()}),/没有该组织的管理权限/);

  const portfolio=await createPortfolio(tenant,admin,{
    idempotencyKey:randomUUID(),name:'Roadmap',description:'Strategic mix'});
  assert.equal(portfolio.name,'Roadmap');
  const program=await createProgram(tenant,admin,{
    idempotencyKey:randomUUID(),name:'Platform upgrade',
    description:'Cross-team benefits',portfolioId:portfolio.id});
  assert.equal(program.portfolio_id,portfolio.id);
  await assert.rejects(createProgram(foreign,outsider,{
    idempotencyKey:randomUUID(),name:'Foreign program',description:'',
    portfolioId:portfolio.id,
  }),e=>(e as {code?:string}).code==='23503',
    'Cross-tenant portfolio FK must reject program creation');

  await assert.rejects(listTenantMembers(tenant,candidate),
    /没有该组织的管理权限/);
  await assert.rejects(listTenantAllocations(foreign,admin),
    /没有该组织的管理权限/);
  const invited={idempotencyKey:randomUUID(),
    email:'tenant-candidate-'+seed+'@example.test'};
  const added=await addTenantMember(tenant,admin,invited);
  assert.deepEqual(added,{ok:true});
  assert.deepEqual(await addTenantMember(tenant,admin,invited),added);
  await assert.rejects(addTenantMember(tenant,admin,{
    idempotencyKey:randomUUID(),email:'nonexistent-'+seed+'@example.test',
  }),/请先为该人员签发组织邀请码/);
  const members=await listTenantMembers(tenant,admin);
  assert.deepEqual(new Set(members.members.map(x=>x.id)),
    new Set([admin,admin2,candidate]));
  await assert.rejects(listTenantMembers(tenant,candidate),
    /没有该组织的管理权限/);

  const assigned={idempotencyKey:randomUUID(),userId:candidate,
    role:'lead' as const};
  const lead=await assignDepartmentMember(tenant,admin,dep.id,assigned);
  assert.equal(lead.member.role,'lead');
  assert.deepEqual(await assignDepartmentMember(
    tenant,admin,dep.id,assigned),lead);
  await assert.rejects(assignDepartmentMember(tenant,admin,dep.id,{
    ...assigned,idempotencyKey:randomUUID(),
  }),/该人员已经拥有目标部门角色/);

  const project=(await createProjectCommand(admin,{
    tenantId:tenant,name:'Allocations for commands',
    timezone:'Asia/Shanghai',idempotencyKey:randomUUID(),
  })).project.id;
  projects.push(project);
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'member')`,[project,candidate]);
  const allocationInput={idempotencyKey:randomUUID(),projectId:project,
    userId:candidate,percentage:60,startDate:'2026-10-17',endDate:'2026-10-30'};
  const allocated=await recordTenantAllocation(tenant,admin,allocationInput);
  assert.ok(allocated.id);
  assert.deepEqual(await recordTenantAllocation(
    tenant,admin,allocationInput),allocated);
  const allocations=await listTenantAllocations(tenant,admin);
  assert.equal(allocations.allocations.filter(x=>x.id===allocated.id).length,1);
  assert.equal(allocations.allocations.find(x=>x.id===allocated.id)?.start_date,
    '2026-10-17');
  await assert.rejects(recordTenantAllocation(tenant,admin,{
    ...allocationInput,idempotencyKey:randomUUID(),percentage:50,
  }),/跨项目总投入将超过100%/);
  await assert.rejects(recordTenantAllocation(foreign,outsider,{
    ...allocationInput,idempotencyKey:randomUUID(),
  }),/资源只能分配给本组织内当前可承担执行责任的项目成员/);

  const cancel={idempotencyKey:randomUUID()};
  const cancelled=await cancelTenantAllocation(tenant,admin,allocated.id,cancel);
  assert.deepEqual(cancelled,{ok:true,allocationId:allocated.id});
  assert.deepEqual(await cancelTenantAllocation(
    tenant,admin,allocated.id,cancel),cancelled);
  await assert.rejects(cancelTenantAllocation(tenant,admin,allocated.id,{
    idempotencyKey:randomUUID(),
  }),/资源分配不存在或已经取消/);
  assert.ok((await listTenantAllocations(tenant,admin)).allocations
    .find(x=>x.id===allocated.id)?.cancelled_at);

  const demote={idempotencyKey:randomUUID(),role:'member' as const};
  const changed=await changeTenantMemberRole(tenant,admin2,admin,demote);
  assert.equal(changed.member.role,'member');
  assert.deepEqual(await changeTenantMemberRole(tenant,admin2,admin,demote),changed);
  await assert.rejects(createPortfolio(tenant,admin,{
    idempotencyKey:randomUUID(),name:'Denied',description:'',
  }),/没有该组织的管理权限/);
  await assert.rejects(listTenantMembers(tenant,admin),
    /没有该组织的管理权限/);
  const selfRole={idempotencyKey:randomUUID(),role:'member' as const};
  await assert.rejects(changeTenantMemberRole(tenant,admin2,admin2,selfRole),
    /组织至少保留一位管理员/);
  const promoted=await changeTenantMemberRole(tenant,admin2,candidate,{
    idempotencyKey:randomUUID(),role:'admin',
  });
  assert.equal(promoted.member.role,'admin');
  const selfChanged=await changeTenantMemberRole(tenant,admin2,admin2,selfRole);
  assert.equal(selfChanged.member.role,'member');
  assert.deepEqual(await changeTenantMemberRole(tenant,admin2,admin2,selfRole),
    selfChanged,'Completed demotion is replayable but cannot be repeated');
  await assert.rejects(changeTenantMemberRole(tenant,admin2,admin2,{
    idempotencyKey:randomUUID(),role:'admin',
  }),/没有该组织的管理权限/);
  assert.equal((await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM tenant_members
    WHERE tenant_id=$1 AND role='admin'`,[tenant])).rows[0].n,1,
    'The organization must retain exactly one surviving administrator');

  const scopedAudit=await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM organization_audit_entries
    WHERE tenant_id=$1 AND action IN (
      'department.created','portfolio.created','program.created',
      'tenant.member_added','department.member_assigned',
      'allocation.recorded','allocation.cancelled','tenant.member_role_changed')
  `,[tenant]);
  assert.equal(scopedAudit.rows[0].n,10);
  console.log('Tenant governance Core: idempotency, admin snapshot, capacity, lifecycle, roles');
}finally{
  for(const id of projects)await pool.query(`
    UPDATE outbox_events SET processed_at=NOW(),claimed_at=NULL,claim_token=NULL
    WHERE project_id=$1 AND processed_at IS NULL AND dead_at IS NULL
  `,[id]);
  await pool.end();
}
