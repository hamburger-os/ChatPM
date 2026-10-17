import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {listMemberProjects} from '../src/project-queries.ts';
import {listPmRegisters,readPmIssueHistory,
  readPmChangeImplementationHistory,listPmTaskDependencies} from
  '../src/governance/pm-register-query.ts';

const suffix=randomUUID();
try{
  const addUser=async(name:string)=>{
    const {rows}=await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id
    `,[name+'-'+suffix+'@example.test',name]);
    return rows[0].id;
  };
  const owner=await addUser('pm-read-owner');
  const observer=await addUser('pm-read-observer');
  const outsider=await addUser('pm-read-outsider');
  const {rows:tenants}=await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('PM read tenant'),('PM read foreign')
    RETURNING id`);
  const [tenant,foreign]=tenants.map(x=>x.id);
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($4,$5,'admin')
  `,[tenant,owner,observer,foreign,outsider]);
  const {rows:mainRows}=await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'PM read project') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[tenant,owner]);
  const project=mainRows[0].id;
  const foreignProject=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Secret PM project') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,
    [foreign,outsider])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'observer'),($4,$5,'owner')
   ON CONFLICT DO NOTHING`,[project,owner,observer,foreignProject,outsider]);

  const issue=(await pool.query<{id:string}>(`
    INSERT INTO project_issues(project_id,title,severity,created_by,version)
    VALUES($1,'Delivery blocker','high',$2,55) RETURNING id
  `,[project,owner])).rows[0].id;
  const otherIssue=(await pool.query<{id:string}>(`
    INSERT INTO project_issues(project_id,title,severity,created_by)
    VALUES($1,'Other project issue','low',$2) RETURNING id
  `,[foreignProject,outsider])).rows[0].id;
  await pool.query(`
    INSERT INTO project_issue_transitions(project_id,issue_id,
      from_status,to_status,issue_version,note,actor_id)
    SELECT $1,$2,
      CASE WHEN v % 2=0 THEN 'open' ELSE 'resolved' END,
      CASE WHEN v % 2=0 THEN 'resolved' ELSE 'open' END,
      v,'Issue transition '||v,$3
    FROM generate_series(2,55) v
  `,[project,issue,owner]);

  const change=(await pool.query<{id:string}>(`
    INSERT INTO project_change_requests(project_id,title,rationale,impact,
      status,version,created_by,decided_by,decided_at,
      implementation_owner_id,implementation_started_at)
    VALUES($1,'Approved implementation','Scope','Schedule','implementing',55,
      $2,$2,NOW(),$2,NOW()) RETURNING id
  `,[project,owner])).rows[0].id;
  const otherChange=(await pool.query<{id:string}>(`
    INSERT INTO project_change_requests(project_id,title,rationale,impact,created_by)
    VALUES($1,'Secret change','Reason','Impact',$2) RETURNING id
  `,[foreignProject,outsider])).rows[0].id;
  await pool.query(`
    INSERT INTO project_change_implementation_history(project_id,change_id,
      change_version,action,from_status,to_status,note,actor_id)
    SELECT $1,$2,v,
      CASE WHEN v=3 THEN 'start' ELSE 'reassign' END,
      CASE WHEN v=3 THEN 'approved' ELSE 'implementing' END,
      'implementing','Change transition '||v,$3
    FROM generate_series(3,55) v
  `,[project,change,owner]);

  const {rows:tasks}=await pool.query<{id:string}>(`
    INSERT INTO tasks(project_id,title)
    VALUES($1,'Dependent'),($1,'Prerequisite') RETURNING id
  `,[project]);
  await pool.query(`
    INSERT INTO task_dependencies(project_id,dependent_task_id,
      prerequisite_task_id,created_by) VALUES($1,$2,$3,$4)
  `,[project,tasks[0].id,tasks[1].id,owner]);

  assert.deepEqual((await listMemberProjects(observer)).projects.map(p=>p.id),
    [project]);
  assert.deepEqual((await listMemberProjects(outsider)).projects.map(p=>p.id),
    [foreignProject]);
  assert.equal((await listPmRegisters(project,observer)).issues.length,1);
  const dependencies=await listPmTaskDependencies(project,observer);
  assert.equal(dependencies.dependencies.length,1);
  assert.equal(dependencies.dependencies[0].dependent_task_id,tasks[0].id);

  const issues=await readPmIssueHistory(project,issue,observer);
  assert.equal(issues.history.length,50);
  assert.equal(issues.history[0].issue_version,55);
  assert.equal(issues.history[49].issue_version,6);
  assert.equal(issues.nextBeforeVersion,6);
  const olderIssues=await readPmIssueHistory(
    project,issue,observer,issues.nextBeforeVersion);
  assert.deepEqual(olderIssues.history.map(x=>x.issue_version),[5,4,3,2]);
  assert.equal(olderIssues.nextBeforeVersion,null);
  const changes=await readPmChangeImplementationHistory(project,change,owner);
  assert.equal(changes.history.length,50);
  assert.equal(changes.history[0].change_version,55);
  assert.equal(changes.nextBeforeVersion,6);
  const olderChanges=await readPmChangeImplementationHistory(
    project,change,observer,changes.nextBeforeVersion);
  assert.deepEqual(olderChanges.history.map(x=>x.change_version),[5,4,3]);

  await assert.rejects(readPmIssueHistory(project,otherIssue,observer),
    /问题不存在或无权限/);
  await assert.rejects(readPmChangeImplementationHistory(
    project,otherChange,observer),/变更申请不存在或无权限/);
  for(const action of [
    ()=>listPmRegisters(project,outsider),
    ()=>listPmTaskDependencies(project,outsider),
    ()=>readPmIssueHistory(project,issue,outsider),
    ()=>readPmChangeImplementationHistory(project,change,outsider),
  ])await assert.rejects(action(),/项目不存在或无权限/);
  for(const invalid of [-1,0,1.2,2147483648,NaN,Infinity]){
    await assert.rejects(readPmIssueHistory(project,issue,owner,invalid),
      /历史版本游标不合法/);
    await assert.rejects(readPmChangeImplementationHistory(
      project,change,owner,invalid),/历史版本游标不合法/);
  }

  // Post-revocation read requests cannot reuse a prior authorized view.
  await pool.query('DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
    [tenant,observer]);
  assert.equal((await listMemberProjects(observer)).projects.length,0);
  for(const action of [
    ()=>listPmRegisters(project,observer),
    ()=>listPmTaskDependencies(project,observer),
    ()=>readPmIssueHistory(project,issue,observer),
    ()=>readPmChangeImplementationHistory(project,change,observer),
  ])await assert.rejects(action(),/项目不存在或无权限/);
  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
    [project,owner]);
  assert.equal((await listMemberProjects(owner)).projects.length,0);
  await assert.rejects(readPmIssueHistory(project,issue,owner),
    /项目不存在或无权限/);
  await assert.rejects(listPmTaskDependencies(project,owner),
    /项目不存在或无权限/);
  console.log('PM reads: pagination, project/tenant scope and membership revocation');
}finally{
  await pool.end();
}
