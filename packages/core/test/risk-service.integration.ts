import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {assessRisk,transitionRisk,riskTarget} from '../src/risk/risk-commands.ts';
import {listProjectRisks,readRiskHistory} from '../src/risk/risk-queries.ts';

assert.equal(riskTarget('open','start_mitigation'),'mitigating');
assert.equal(riskTarget('mitigating','resolve'),'resolved');
assert.equal(riskTarget('resolved','reopen'),'open');
assert.throws(()=>riskTarget('open','resolve'),/风险状态流转不符合管理流程/);

const suffix=randomUUID();
let projectId:string|null=null;
try{
  const makeUser=async(name:string)=>{
    const {rows}=await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,
      [name+'-'+suffix+'@example.test',name]);
    return rows[0].id;
  };
  const owner=await makeUser('risk-owner');
  const observer=await makeUser('risk-observer');
  const stranger=await makeUser('risk-stranger');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Risk service') RETURNING id`)).rows[0].id;
  const otherTenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Risk outsider') RETURNING id`)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($4,$5,'admin')`,
    [tenant,owner,observer,otherTenant,stranger]);
  const pid=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Risk register',$2) RETURNING id`,[tenant,owner])).rows[0].id;
  projectId=pid;
  const another=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Risk outside',$2) RETURNING id`,
    [otherTenant,stranger])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'observer'),($4,$5,'owner')`,
    [pid,owner,observer,another,stranger]);
  const riskId=(await pool.query<{id:string}>(`
    INSERT INTO risks(project_id,title) VALUES($1,'Supplier outage') RETURNING id`,
    [pid])).rows[0].id;
  assert.equal((await listProjectRisks(pid,observer)).risks.length,1);
  await assert.rejects(listProjectRisks(pid,stranger),/项目不存在或无权限/);
  await assert.rejects(readRiskHistory(pid,riskId,stranger),
    /项目不存在或无权限/);
  await assert.rejects(readRiskHistory(another,riskId,stranger),
    /风险不存在/,'Risk IDs cannot be relabeled into another project');
  await assert.rejects(transitionRisk(pid,riskId,owner,{
    idempotencyKey:randomUUID(),expectedVersion:1,
    decision:'start_mitigation',note:'Premature mitigation',
  }),/应对前必须明确风险评估/);
  const assessment={
    idempotencyKey:randomUUID(),expectedVersion:1,
    likelihood:3,impact:4,ownerId:owner,responsePlan:'Switch supplier',
    note:'Evidence from delivery review',
  };
  const assessed=await assessRisk(pid,riskId,owner,assessment);
  assert.equal(assessed.risk.version,2);
  const replay=await assessRisk(pid,riskId,owner,assessment);
  assert.deepEqual(JSON.parse(JSON.stringify(replay)),
    JSON.parse(JSON.stringify(assessed)));
  await assert.rejects(assessRisk(pid,riskId,owner,{
    ...assessment,responsePlan:'Different',idempotencyKey:assessment.idempotencyKey,
  }),/幂等键/);
  await assert.rejects(assessRisk(pid,riskId,observer,{
    ...assessment,idempotencyKey:randomUUID(),expectedVersion:2,
  }),/没有执行该操作的权限/);
  const mitigating=await transitionRisk(pid,riskId,owner,{
    idempotencyKey:randomUUID(),expectedVersion:2,
    decision:'start_mitigation',note:'Start approved plan',
  });
  assert.equal(mitigating.risk.version,3);
  const resolved=await transitionRisk(pid,riskId,owner,{
    idempotencyKey:randomUUID(),expectedVersion:3,
    decision:'resolve',note:'Risk retired after controls',
  });
  assert.equal(resolved.risk.version,4);
  await assert.rejects(assessRisk(pid,riskId,owner,{
    ...assessment,idempotencyKey:randomUUID(),expectedVersion:4,
  }),/已关闭风险需先重新打开/);
  const history=await readRiskHistory(pid,riskId,observer);
  assert.deepEqual(history.history.map(x=>x.risk_version),[4,3,2]);
  assert.equal(history.history[0].action,'transition');
  assert.equal((await readRiskHistory(pid,riskId,owner,4)).history.length,2);
  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
    [pid,observer]);
  await assert.rejects(listProjectRisks(pid,observer),/项目不存在或无权限/);
  await assert.rejects(readRiskHistory(pid,riskId,observer),/项目不存在或无权限/);
  console.log('Core Risk contract: secured read, tenant and project scope, role, transitions and history');
}finally{
  // Isolate global Outbox-claim tests from this formal Risk command fixture.
  if(projectId)await pool.query(`
    UPDATE outbox_events SET processed_at=NOW()
    WHERE project_id=$1 AND processed_at IS NULL AND dead_at IS NULL
  `,[projectId]);
  await pool.end();
}
