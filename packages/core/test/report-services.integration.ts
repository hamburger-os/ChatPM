import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {listProjectReports,requestProjectReport,publishProjectReport} from
  '../src/reporting/report-services.ts';

const suffix=randomUUID();
let projectId:string|null=null;
try{
  async function user(label:string){
    return (await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,
    [label+'-'+suffix+'@example.test',label])).rows[0].id;
  }
  const owner=await user('report-owner');
  const manager=await user('report-manager');
  const observer=await user('report-observer');
  const outsider=await user('report-outsider');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Reporting commands') RETURNING id`)).rows[0].id;
  const foreign=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Foreign reporting') RETURNING id`)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($1,$4,'member'),($5,$6,'admin')`,
    [tenant,owner,manager,observer,foreign,outsider]);
  projectId=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Project reporting',$2) RETURNING id`,[tenant,owner])).rows[0].id;
  const foreignProject=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Foreign project reporting',$2) RETURNING id`,
    [foreign,outsider])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'manager'),($1,$4,'observer'),($5,$6,'owner')`,
    [projectId,owner,manager,observer,foreignProject,outsider]);
  await pool.query('INSERT INTO tasks(project_id,title) VALUES($1,$2)',
    [projectId,'First report fact']);
  assert.equal((await listProjectReports(projectId,observer)).reports.length,0);
  await assert.rejects(listProjectReports(projectId,outsider),
    /项目不存在或无权限/);
  await assert.rejects(listProjectReports(foreignProject,owner),
    /项目不存在或无权限/);
  const gen={kind:'week' as const,idempotencyKey:randomUUID()};
  await assert.rejects(requestProjectReport(projectId,manager,gen),
    /没有执行该操作的权限/);
  await assert.rejects(requestProjectReport(projectId,observer,gen),
    /没有执行该操作的权限/);
  const first=await requestProjectReport(projectId,owner,gen);
  assert.equal(first.report.state,'draft');
  assert.equal(first.report.kind,'week');
  assert.equal(first.report.revision,1);
  assert.match(first.report.content,/总数：1；/);
  const replay=await requestProjectReport(projectId,owner,gen);
  assert.deepEqual(JSON.parse(JSON.stringify(replay)),
    JSON.parse(JSON.stringify(first)),'Same intent must replay original receipt');
  const foreignRead=await listProjectReports(projectId,manager);
  assert.equal(foreignRead.reports.length,1);
  assert.equal(foreignRead.reports[0].id,first.report.id);
  await assert.rejects(publishProjectReport(foreignProject,first.report.id,outsider,{
    idempotencyKey:randomUUID(),expectedRevision:1,
  }),/报告不存在或不属于当前项目/);
  await assert.rejects(publishProjectReport(projectId,first.report.id,manager,{
    idempotencyKey:randomUUID(),expectedRevision:1,
  }),/没有执行该操作的权限/);
  await assert.rejects(publishProjectReport(projectId,first.report.id,owner,{
    idempotencyKey:randomUUID(),expectedRevision:999,
  }),/报告已发布或版本已更新/);
  const publish={idempotencyKey:randomUUID(),expectedRevision:1};
  const published=await publishProjectReport(projectId,first.report.id,owner,publish);
  assert.equal(published.ok,true);
  assert.equal(published.report.revision,2);
  assert.equal(published.report.state,'published');
  assert.deepEqual(JSON.parse(JSON.stringify(
    await publishProjectReport(projectId,first.report.id,owner,publish))),
    JSON.parse(JSON.stringify(published)));
  await assert.rejects(publishProjectReport(projectId,first.report.id,owner,{
    idempotencyKey:randomUUID(),expectedRevision:1,
  }),/报告已发布或版本已更新/);
  await pool.query('INSERT INTO tasks(project_id,title) VALUES($1,$2)',
    [projectId,'Second task after publication']);
  const later=await requestProjectReport(projectId,owner,{
    idempotencyKey:randomUUID(),kind:'week',
  });
  assert.equal(later.report.id,first.report.id);
  assert.equal(later.report.content,first.report.content,
    'Published snapshot is immutable even if current tasks change');
  for(const kind of ['report.generation_requested.v1','report.published.v1']){
    const counts:{rows:Array<{events:number;receipts:number}>}=await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM domain_events
        WHERE project_id=$1 AND kind=$2) AS events,
      (SELECT COUNT(*)::int FROM command_receipts
        WHERE project_id=$1 AND kind=$2) AS receipts`,
      [projectId,kind]);
    assert.equal(counts.rows[0].events,kind==='report.generation_requested.v1'?2:1);
    assert.equal(counts.rows[0].receipts,counts.rows[0].events);
  }
  await pool.query('DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
    [tenant,owner]);
  await assert.rejects(listProjectReports(projectId,owner),
    /项目不存在或无权限/);
  await assert.rejects(requestProjectReport(projectId,owner,{
    idempotencyKey:randomUUID(),kind:'month',
  }),/项目不存在或无权限/);
  await assert.rejects(publishProjectReport(projectId,first.report.id,owner,{
    idempotencyKey:randomUUID(),expectedRevision:2,
  }),/项目不存在或无权限/);
  console.log('Reporting Core: scoped read, role, receipts, publication, revocation');
}finally{
  if(projectId)await pool.query(`
    UPDATE outbox_events SET processed_at=NOW(),claimed_at=NULL,claim_token=NULL
    WHERE project_id=$1 AND processed_at IS NULL AND dead_at IS NULL`,[projectId]);
  await pool.end();
}
