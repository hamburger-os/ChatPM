import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {decideProgress,decideProposal} from '../src/approval/decision-commands.ts';

const suffix=randomUUID();
let projectId:string|null=null;
try{
  const user=async(label:string)=>{
    const {rows}=await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,
      [label+'-'+suffix+'@example.test',label]);
    return rows[0].id;
  };
  const owner=await user('approval-owner');
  const observer=await user('approval-observer');
  const outsider=await user('approval-outsider');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Approval Core integration') RETURNING id`)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($1,$4,'member')`,
    [tenant,owner,observer,outsider]);
  const pid=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Review transactions') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[tenant,owner])).rows[0].id;
  projectId=pid;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'observer') ON CONFLICT DO NOTHING`,[pid,owner,observer]);
  const message=(await pool.query<{id:string}>(`
    INSERT INTO messages(project_id,author_id,kind,content,client_nonce)
    VALUES($1,$2,'user','Proposal context',$3) RETURNING id`,
    [pid,owner,randomUUID()])).rows[0].id;
  const task=(await pool.query<{id:string}>(`
    INSERT INTO tasks(project_id,title) VALUES($1,'Review source') RETURNING id`,
    [pid])).rows[0].id;
  const progress=(await pool.query<{id:string}>(`
    INSERT INTO task_progress_updates(project_id,task_id,source_message_id,
      summary,kind,model_name,prompt_version)
    VALUES($1,$2,$3,'Blocked by supplier','blocker','mock','v1') RETURNING id`,
    [pid,task,message])).rows[0].id;

  const progressInput={idempotencyKey:randomUUID(),decision:'accepted' as const};
  await assert.rejects(decideProgress(pid,progress,observer,progressInput),
    /没有执行该操作的权限/);
  await assert.rejects(decideProgress(pid,progress,outsider,progressInput),
    /项目不存在或无权限/);
  assert.deepEqual(await decideProgress(pid,progress,owner,progressInput),{ok:true});
  assert.deepEqual(await decideProgress(pid,progress,owner,progressInput),{ok:true});
  await assert.rejects(decideProgress(pid,progress,owner,{
    ...progressInput,decision:'rejected',
  }),/幂等键已经用于其他命令/);
  await assert.rejects(decideProgress(pid,progress,owner,{
    idempotencyKey:randomUUID(),decision:'accepted',
  }),/进度建议已处理或不存在/);
  const count=async(table:string,id:string)=>{
    const {rows}=await pool.query<{n:number}>(`
      SELECT count(*)::int AS n FROM domain_events
      WHERE project_id=$1 AND aggregate_id=$2 AND kind=$3`,
      [pid,id,table]);
    return rows[0].n;
  };
  assert.equal(await count('task.progress.reviewed.v1',progress),1);
  assert.equal((await pool.query<{status:string}>(`
    SELECT status FROM tasks WHERE id=$1`,[task])).rows[0].status,'todo',
    'Approving an AI status claim does not complete the official Task');

  for(const kind of ['task','risk'] as const){
    const proposal=(await pool.query<{id:string}>(`
      INSERT INTO proposed_changes(project_id,source_message_id,kind,title,detail)
      VALUES($1,$2,$3,$4,'Human review required') RETURNING id`,
      [pid,message,kind,'Proposed '+kind])).rows[0].id;
    const input={idempotencyKey:randomUUID(),decision:'accepted' as const,
      assigneeId:owner};
    await assert.rejects(decideProposal(pid,proposal,observer,input),
      /没有执行该操作的权限/);
    await assert.rejects(decideProposal(pid,proposal,outsider,input),
      /项目不存在或无权限/);
    assert.deepEqual(await decideProposal(pid,proposal,owner,input),{ok:true});
    assert.deepEqual(await decideProposal(pid,proposal,owner,input),{ok:true});
    await assert.rejects(decideProposal(pid,proposal,owner,{
      ...input,decision:'rejected',
    }),/幂等键已经用于其他命令/);
    await assert.rejects(decideProposal(pid,proposal,owner,{
      ...input,idempotencyKey:randomUUID(),
    }),/该事项已经处理/);
    const target=kind==='task'?'tasks':'risks';
    const {rows}=await pool.query<{n:number}>(`
      SELECT count(*)::int AS n FROM ${target}
      WHERE project_id=$1 AND source_proposal_id=$2`,[pid,proposal]);
    assert.equal(rows[0].n,1,'Exactly one official record is created');
    assert.equal(await count('proposal.reviewed.v1',proposal),1);
    assert.equal((await pool.query<{n:number}>(`
      SELECT count(*)::int AS n FROM audit_entries
      WHERE project_id=$1 AND action='proposal.reviewed.v1' AND target_id=$2`,
      [pid,proposal])).rows[0].n,1);
  }
  console.log('Approval Core: current authorization, idempotency, single official insert, audit');
}finally{
  if(projectId)await pool.query(`
    UPDATE outbox_events SET processed_at=NOW()
    WHERE project_id=$1 AND processed_at IS NULL AND dead_at IS NULL
  `,[projectId]);
  await pool.end();
}
