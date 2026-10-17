import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {getProjectDetails,getProjectAiAuthorization,listProjectAiInvocations,
  listProjectAiRuns} from '../src/project-queries.ts';
import {listProjectProgress,listProjectProposals} from '../src/approval/review-queries.ts';

const suffix=randomUUID();
try{
  async function user(label:string){
    return (await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,
    [label+'-'+suffix+'@example.test',label])).rows[0].id;
  }
  const owner=await user('reads-owner');
  const manager=await user('reads-manager');
  const observer=await user('reads-observer');
  const outsider=await user('reads-outsider');
  const tenant=(await pool.query<{id:string}>(
    "INSERT INTO tenants(name) VALUES('Scoped project reads') RETURNING id")).rows[0].id;
  const foreign=(await pool.query<{id:string}>(
    "INSERT INTO tenants(name) VALUES('Foreign scoped reads') RETURNING id")).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($1,$4,'member'),($5,$6,'admin')`,
    [tenant,owner,manager,observer,foreign,outsider]);
  const project=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Protected read model') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[tenant,owner])).rows[0].id;
  const other=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Other protected read') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[foreign,outsider])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'manager'),($1,$4,'observer'),($5,$6,'owner') ON CONFLICT DO NOTHING`,
    [project,owner,manager,observer,other,outsider]);

  const source=(await pool.query<{id:string}>(`
    INSERT INTO messages(project_id,author_id,kind,content,client_nonce)
    VALUES($1,$2,'user','This work is progressing',$3) RETURNING id`,
    [project,owner,'scoped-reads-'+suffix])).rows[0].id;
  const task=(await pool.query<{id:string}>(`
    INSERT INTO tasks(project_id,title) VALUES($1,'Owner task') RETURNING id`,
    [project])).rows[0].id;
  await pool.query(`
    INSERT INTO task_progress_updates(
      project_id,task_id,source_message_id,summary,kind,model_name,prompt_version)
    VALUES($1,$2,$3,'Draft complete','progress','test-model','test-v1')`,
    [project,task,source]);
  await pool.query(`
    INSERT INTO proposed_changes(project_id,source_message_id,kind,title)
    VALUES($1,$2,'risk','Schedule risk')`,[project,source]);
  await pool.query(`
    INSERT INTO ai_analysis_runs(project_id,source_message_id,kind,status)
    VALUES($1,$2,'extract','proposal')`,[project,source]);
  await pool.query(`
    INSERT INTO ai_model_invocations(project_id,authorization_version,
      model_identity,prompt_version,input_fingerprint)
    VALUES($1,1,'test-model','test-v1',repeat('a',64))`,[project]);

  const details=await getProjectDetails(project,observer);
  assert.equal(details.project.name,'Protected read model');
  assert.equal(details.project.owner_id,owner);
  assert.equal((await listProjectProgress(project,observer)).updates[0].task_title,
    'Owner task');
  assert.equal((await listProjectProposals(project,manager)).proposals[0].title,
    'Schedule risk');
  assert.equal((await listProjectProgress(project,observer)).updates.length,1);
  assert.equal((await listProjectProposals(project,observer)).proposals.length,1);
  assert.equal((await listProjectProgress(other,outsider)).updates.length,0);
  assert.equal((await listProjectProposals(other,outsider)).proposals.length,0);

  assert.deepEqual(await getProjectAiAuthorization(project,owner),
    {authorization:{enabled:false,version:1}});
  assert.equal((await listProjectAiRuns(project,owner)).runs.length,1);
  assert.equal((await listProjectAiInvocations(project,owner)).invocations.length,1);
  for(const fn of [getProjectAiAuthorization,listProjectAiRuns,
    listProjectAiInvocations]){
    await assert.rejects(fn(project,manager),/没有执行该操作的权限/);
    await assert.rejects(fn(project,observer),/没有执行该操作的权限/);
    await assert.rejects(fn(project,outsider),/项目不存在或无权限/);
  }
  for(const fn of [getProjectDetails,listProjectProgress,listProjectProposals]){
    await assert.rejects(fn(project,outsider),/项目不存在或无权限/);
    await assert.rejects(fn(other,observer),/项目不存在或无权限/);
  }

  await pool.query('DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
    [tenant,observer]);
  for(const fn of [getProjectDetails,listProjectProgress,listProjectProposals]){
    await assert.rejects(fn(project,observer),/项目不存在或无权限/);
  }
  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
    [project,owner]);
  for(const fn of [getProjectDetails,getProjectAiAuthorization,
    listProjectAiInvocations,listProjectAiRuns,listProjectProgress,
    listProjectProposals]){
    await assert.rejects(fn(project,owner),/项目不存在或无权限/);
  }
  console.log('Project read models: roles, data scope, tenant/project revocation');
}finally{
  await pool.end();
}
