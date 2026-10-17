import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../src/db.ts';
import {createProjectCommand} from '../src/project-creation.ts';
import {getProjectDetails,listMemberProjects} from '../src/project-queries.ts';
import {transferProjectOwnership} from '../src/identity/project-governance.ts';

const suffix=randomUUID();
let projectId:string|null=null;
let createdId:string|null=null;
try{
  const user=async(kind:string)=>{
    const {rows}=await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id
    `,[kind+'-'+suffix+'@example.test',kind]);
    return rows[0].id;
  };
  const owner=await user('single-owner');
  const candidate=await user('single-owner-candidate');
  const outsider=await user('single-owner-outsider');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Owner authority checks') RETURNING id
  `)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member')`,[tenant,owner,candidate]);

  assert.equal((await pool.query<{count:number}>(`
    SELECT COUNT(*)::int AS count FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects'
      AND column_name='owner_id'`)).rows[0].count,0,
    'Project owner identity must not be stored twice');

  // A transaction that does not establish an owner cannot commit.
  await assert.rejects(pool.query(`
    INSERT INTO projects(tenant_id,name) VALUES($1,'Invalid orphan')`,
    [tenant]),(e:unknown)=>(e as {code?:string}).code==='23514');
  const noOrphans=await pool.query<{count:number}>(`
    SELECT COUNT(*)::int AS count FROM projects
    WHERE tenant_id=$1 AND name='Invalid orphan'`,[tenant]);
  assert.equal(noOrphans.rows[0].count,0);

  const initial=await createProjectCommand(owner,{
    tenantId:tenant,name:'Single owner source',timezone:'Asia/Shanghai',
    idempotencyKey:randomUUID(),
  });
  projectId=initial.project.id;
  assert.equal(initial.project.owner_id,owner);
  assert.equal(initial.project.ownership_revision,1);
  createdId=projectId;
  const detail=await getProjectDetails(projectId,owner);
  assert.equal(detail.project.owner_id,owner);
  assert.equal((await listMemberProjects(owner)).projects
    .find(p=>p.id===projectId)?.owner_id,owner);

  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'manager')`,[projectId,candidate]);

  // Direct writes cannot commit a zero-owner or two-owner state.
  for(const statement of [
    "UPDATE project_members SET role='manager' WHERE project_id=$1 AND user_id=$2",
    'DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
  ]){
    await assert.rejects(pool.query(statement,[projectId,owner]),
      (e:unknown)=>(e as {code?:string}).code==='23514');
    assert.equal((await getProjectDetails(projectId,owner)).project.owner_id,owner);
  }
  await assert.rejects(pool.query(`
    UPDATE project_members SET role='owner'
    WHERE project_id=$1 AND user_id=$2`,[projectId,candidate]),
    (e:unknown)=>(e as {code?:string}).code==='23505');

  await assert.rejects(transferProjectOwnership(projectId,outsider,{
    targetUserId:candidate,expectedRevision:1,idempotencyKey:randomUUID(),
  }),/项目不存在或无权限/);
  await assert.rejects(transferProjectOwnership(projectId,candidate,{
    targetUserId:owner,expectedRevision:1,idempotencyKey:randomUUID(),
  }),/没有执行该操作的权限/);

  const command={
    targetUserId:candidate,expectedRevision:1,idempotencyKey:randomUUID(),
  };
  const changed=await transferProjectOwnership(projectId,owner,command);
  assert.equal(changed.ownerId,candidate);
  assert.equal(changed.previousOwnerId,owner);
  assert.equal(changed.ownershipRevision,2);
  assert.deepEqual(await transferProjectOwnership(projectId,owner,command),changed);
  await assert.rejects(transferProjectOwnership(projectId,owner,{
    ...command,idempotencyKey:randomUUID(),expectedRevision:2,
  }),/没有执行该操作的权限/);

  const records=(await pool.query<{user_id:string;role:string}>(`
    SELECT user_id,role FROM project_members WHERE project_id=$1
    ORDER BY user_id`,[projectId])).rows;
  assert.equal(records.filter(x=>x.role==='owner').length,1);
  assert.equal(records.find(x=>x.role==='owner')?.user_id,candidate);
  assert.equal(records.find(x=>x.user_id===owner)?.role,'manager');
  assert.equal((await getProjectDetails(projectId,owner)).project.owner_id,candidate);
  assert.equal((await listMemberProjects(owner)).projects
    .find(x=>x.id===projectId)?.owner_id,candidate);
  assert.equal((await listMemberProjects(candidate)).projects
    .find(x=>x.id===projectId)?.role,'owner');
  assert.equal((await pool.query<{ownership_revision:number}>(`
    SELECT ownership_revision FROM projects WHERE id=$1`,[projectId])
  ).rows[0].ownership_revision,2);

  // Standalone owner-to-owner UPDATE is invalid: use the Core command's
  // serialized demote/promote steps inside one transaction.
  await assert.rejects(transaction(async db=>{
    await db.query("UPDATE project_members SET role='manager' WHERE project_id=$1 AND user_id=$2",
      [projectId,candidate]);
  }), (e:unknown)=>(e as {code?:string}).code==='23514');

  // Projects and owner rows may be deleted together without blocking a
  // legitimate project teardown (FK cascades must not create a false alarm).
  const ephemeral=await createProjectCommand(owner,{
    tenantId:tenant,name:'Owner teardown test',timezone:'Asia/Shanghai',
    idempotencyKey:randomUUID(),
  });
  await pool.query('DELETE FROM projects WHERE id=$1',[ephemeral.project.id]);
  assert.equal((await pool.query('SELECT 1 FROM project_members WHERE project_id=$1',
    [ephemeral.project.id])).rowCount,0);
  console.log('Owner authority: non-null exact owner, single role source, atomic handoff, review and replay');
}finally{
  for(const id of [projectId,createdId]){
    if(id)await pool.query(`
      UPDATE outbox_events SET processed_at=NOW(),claimed_at=NULL,claim_token=NULL
      WHERE project_id=$1 AND processed_at IS NULL AND dead_at IS NULL
    `,[id]);
  }
  await pool.end();
}
