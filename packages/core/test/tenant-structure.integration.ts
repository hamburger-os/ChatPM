import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {getTenantStructure} from '../src/governance/structure-query.ts';

const suffix=randomUUID();
try{
  const makeUser=async(kind:string)=>{
    const result=await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'test-not-login') RETURNING id`,
      [kind+'-'+suffix+'@example.test',kind]);
    return result.rows[0].id;
  };
  const admin=await makeUser('structure-admin');
  const member=await makeUser('structure-member');
  const stranger=await makeUser('structure-stranger');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Structure integration') RETURNING id`)).rows[0].id;
  const another=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Outside tenant') RETURNING id`)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($4,$5,'admin')`,
    [tenant,admin,member,another,stranger]);
  const dep=(await pool.query<{id:string}>(`
    INSERT INTO departments(tenant_id,name) VALUES($1,'Participant') RETURNING id`,
    [tenant])).rows[0].id;
  const portfolio=(await pool.query<{id:string}>(`
    INSERT INTO portfolios(tenant_id,name) VALUES($1,'Portfolio') RETURNING id`,
    [tenant])).rows[0].id;
  const program=(await pool.query<{id:string}>(`
    INSERT INTO programs(tenant_id,name,portfolio_id)
    VALUES($1,'Program',$2) RETURNING id`,[tenant,portfolio])).rows[0].id;
  const create=async(name:string,tenantId:string,owning:string,programId:string|null)=>{
    const {rows}=await pool.query<{id:string}>(`
      WITH created AS (
      INSERT INTO projects(tenant_id,name,program_id)
      VALUES($1,$3,$4) RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[tenantId,owning,name,programId]);
    return rows[0].id;
  };
  const visible=await create('Visible',tenant,admin,program);
  const secret=await create('Secret',tenant,admin,null);
  const outside=await create('Other tenant secret',another,stranger,null);
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'member'),($3,$4,'owner') ON CONFLICT DO NOTHING`,[visible,member,outside,stranger]);
  await pool.query(`INSERT INTO project_departments(tenant_id,project_id,department_id)
    VALUES($1,$2,$3)`,[tenant,visible,dep]);
  const asAdmin=await getTenantStructure(tenant,admin);
  assert.deepEqual(new Set(asAdmin.projects.map(p=>p.id)),new Set([visible,secret]));
  assert.equal(asAdmin.programs.length,1);
  assert.equal(asAdmin.portfolios.length,1);
  const scoped=await getTenantStructure(tenant,member);
  assert.deepEqual(scoped.projects.map(p=>p.id),[visible]);
  assert.deepEqual(scoped.projects[0].participating_department_ids,[dep]);
  assert.equal(scoped.departments.length,1,
    'Current tenant members can see organization taxonomy without another project');
  assert.equal(scoped.projects.some(p=>p.id===secret||p.id===outside),false);
  await assert.rejects(getTenantStructure(tenant,stranger),/没有该组织的访问权限/);
  await assert.rejects(getTenantStructure(another,member),/没有该组织的访问权限/);
  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
    [visible,member]);
  const afterProjectRemoval=await getTenantStructure(tenant,member);
  assert.equal(afterProjectRemoval.projects.length,0,
    'No project classification may be returned after project membership removal');
  await pool.query('DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
    [tenant,member]);
  await assert.rejects(getTenantStructure(tenant,member),
    /没有该组织的访问权限/,
    'Tenant member revocation must deny the entire organization structure');
  console.log('Organization read model integration: tenant and project grants, classification, revocation');
}finally{
  await pool.end();
}
