import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {changeProjectClassification,type ClassificationInput} from '../src/governance/classification-command.ts';

const suffix=randomUUID();
try{
  const makeUser=async(label:string)=>{
    const {rows}=await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'test-not-login') RETURNING id
    `,[label+'-'+suffix+'@example.test',label]);
    return rows[0].id;
  };
  const admin=await makeUser('classification-admin');
  const member=await makeUser('classification-member');
  const tenant=(await pool.query<{id:string}>(
    "INSERT INTO tenants(name) VALUES('Command test') RETURNING id")).rows[0].id;
  const another=(await pool.query<{id:string}>(
    "INSERT INTO tenants(name) VALUES('Other command tenant') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",
    [tenant,admin,member]);
  const dep=(await pool.query<{id:string}>(`
    INSERT INTO departments(tenant_id,name) VALUES($1,'Owning') RETURNING id
  `,[tenant])).rows[0].id;
  const participation=(await pool.query<{id:string}>(`
    INSERT INTO departments(tenant_id,name) VALUES($1,'Collaborating') RETURNING id
  `,[tenant])).rows[0].id;
  const outside=(await pool.query<{id:string}>(`
    INSERT INTO departments(tenant_id,name) VALUES($1,'Other dept') RETURNING id
  `,[another])).rows[0].id;
  const pid=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Classification') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[tenant,admin])).rows[0].id;
  const input:ClassificationInput={
    idempotencyKey:randomUUID(),expectedRevision:1,
    departmentId:dep,programId:null,portfolioId:null,
    participatingDepartmentIds:[participation],
  };
  const first=await changeProjectClassification(tenant,admin,pid,input);
  assert.equal(first.classification_revision,2);
  assert.deepEqual(first.participating_department_ids,[participation]);
  const replay=await changeProjectClassification(tenant,admin,pid,input);
  assert.deepEqual(replay,first,'Same key and payload must replay original command result');
  await assert.rejects(changeProjectClassification(tenant,admin,pid,{
    ...input,participatingDepartmentIds:[],idempotencyKey:input.idempotencyKey,
  }),/幂等键/,'Different payload must not replay as the same command');
  await assert.rejects(changeProjectClassification(tenant,admin,pid,{
    ...input,idempotencyKey:randomUUID(),expectedRevision:1,
  }),/归属已被修改/,'Old revision may not overwrite current classification');
  await assert.rejects(changeProjectClassification(tenant,member,pid,{
    ...input,idempotencyKey:randomUUID(),expectedRevision:2,
    participatingDepartmentIds:[],
  }),/没有该组织的管理权限/);
  await assert.rejects(changeProjectClassification(tenant,admin,pid,{
    ...input,idempotencyKey:randomUUID(),expectedRevision:2,
    participatingDepartmentIds:[outside],
  }),error=>{
    assert.equal((error as {code?:string}).code,'23503',
      'Tenant composite foreign key must reject other tenants departments');
    return true;
  });
  assert.deepEqual((await pool.query<{department_id:string}>(`
    SELECT department_id FROM project_departments WHERE project_id=$1`,
    [pid])).rows.map(x=>x.department_id),[participation],
    'Rejected changes must roll back both classification and participants');
  const updated=await changeProjectClassification(tenant,admin,pid,{
    ...input,idempotencyKey:randomUUID(),expectedRevision:2,
    participatingDepartmentIds:[],
  });
  assert.equal(updated.classification_revision,3);
  assert.deepEqual(updated.participating_department_ids,[]);
  for(const invalid of [
    {participatingDepartmentIds:[dep]},
    {participatingDepartmentIds:[participation,participation]},
  ]){
    await assert.rejects(changeProjectClassification(tenant,admin,pid,{
      ...input,...invalid,idempotencyKey:randomUUID(),expectedRevision:3,
    }),/主责部门|参与部门重复/);
  }
  const audited=(await pool.query<{count:number}>(`
    SELECT COUNT(*)::int AS count FROM organization_audit_entries
    WHERE tenant_id=$1 AND action='project.classification_changed'`,[tenant])).rows[0].count;
  assert.equal(audited,2,'Only two real changes create audit entries');
  console.log('Classification command integration: versioning, idempotency, rollback, auth and tenant FKs');
}finally{
  await pool.end();
}
