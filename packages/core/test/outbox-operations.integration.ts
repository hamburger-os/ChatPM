import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {readOutboxSummary,readDeadEvents,retryDeadEvent} from
  '../src/operations/outbox-admin.ts';

const suffix=randomUUID();
let projectId:string|null=null;
try{
  async function makeUser(name:string){
    return (await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,[name+'-'+suffix+'@example.test',name])).rows[0].id;
  }
  const owner=await makeUser('operations-owner');
  const observer=await makeUser('operations-observer');
  const stranger=await makeUser('operations-stranger');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Outbox scoped access') RETURNING id`)).rows[0].id;
  const otherTenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Outbox unrelated') RETURNING id`)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($4,$5,'admin')`,
    [tenant,owner,observer,otherTenant,stranger]);
  projectId=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Outbox scope') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[tenant,owner])).rows[0].id;
  const otherProject=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Other scope') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[otherTenant,stranger])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'observer'),($4,$5,'owner') ON CONFLICT DO NOTHING`,
    [projectId,owner,observer,otherProject,stranger]);
  const eventId=(await pool.query<{id:string}>(`
    INSERT INTO outbox_events(project_id,kind,attempts,dead_at,last_error_code)
    VALUES($1,'message.created',3,NOW(),'PROCESSING_ERROR')
    RETURNING id`,[projectId])).rows[0].id;
  const otherEvent=(await pool.query<{id:string}>(`
    INSERT INTO outbox_events(project_id,kind,attempts,dead_at)
    VALUES($1,'message.created',2,NOW()) RETURNING id`,[otherProject])).rows[0].id;
  const summary=await readOutboxSummary(projectId,owner);
  assert.equal(summary.summary.dead,1);
  const dead=await readDeadEvents(projectId,owner);
  assert.equal(dead.events.length,1);
  assert.equal(dead.events[0].id,eventId);
  await assert.rejects(readOutboxSummary(projectId,observer),
    /没有执行该操作的权限/);
  await assert.rejects(readDeadEvents(projectId,observer),
    /没有执行该操作的权限/);
  await assert.rejects(readOutboxSummary(projectId,stranger),
    /项目不存在或无权限/);
  await assert.rejects(readDeadEvents(otherProject,owner),
    /项目不存在或无权限/);
  await assert.rejects(retryDeadEvent(projectId,eventId,observer,{
    idempotencyKey:randomUUID(),
  }),/没有执行该操作的权限/);
  await assert.rejects(retryDeadEvent(otherProject,eventId,stranger,{
    idempotencyKey:randomUUID(),
  }),/事件未隔离或不属于当前项目/);
  await assert.rejects(retryDeadEvent(projectId,otherEvent,owner,{
    idempotencyKey:randomUUID(),
  }),/事件未隔离或不属于当前项目/);
  const input={idempotencyKey:randomUUID()};
  const recovered=await retryDeadEvent(projectId,eventId,owner,input);
  assert.deepEqual(recovered,{ok:true,recoveryRevision:1});
  assert.deepEqual(await retryDeadEvent(projectId,eventId,owner,input),recovered);
  await assert.rejects(retryDeadEvent(projectId,eventId,owner,{
    idempotencyKey:randomUUID(),
  }),/事件未隔离或不属于当前项目/);
  assert.equal((await readOutboxSummary(projectId,owner)).summary.dead,0);
  assert.equal((await readDeadEvents(projectId,owner)).events.length,0);
  const now=(await pool.query<{
    manual_retry_revision:number;attempts:number;dead_at:Date|null;
  }>(`SELECT manual_retry_revision,attempts,dead_at
    FROM outbox_events WHERE id=$1`,[eventId])).rows[0];
  assert.equal(now.manual_retry_revision,1);
  assert.equal(now.attempts,0);
  assert.equal(now.dead_at,null);
  await pool.query(`
    UPDATE outbox_events SET attempts=5,dead_at=NOW(),claimed_at=NULL,
      claim_token=NULL,last_error_code='PROCESSING_ERROR' WHERE id=$1`,[eventId]);
  assert.deepEqual(await retryDeadEvent(projectId,eventId,owner,{
    idempotencyKey:randomUUID(),
  }),{ok:true,recoveryRevision:2});
  const events=(await pool.query<{n:number}>(`
    SELECT count(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND aggregate_id=$2
      AND kind='outbox.dead_letter_retried.v1'`,[projectId,eventId])).rows[0].n;
  assert.equal(events,2,'A second genuine recovery has its own revisioned domain event');
  const history=(await pool.query<{aggregate_version:number}>(`
    SELECT aggregate_version FROM domain_events
    WHERE project_id=$1 AND aggregate_id=$2
      AND kind='outbox.dead_letter_retried.v1'
    ORDER BY aggregate_version`,[projectId,eventId])).rows.map(r=>r.aggregate_version);
  assert.deepEqual(history,[1,2]);
  await pool.query('DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
    [tenant,owner]);
  await assert.rejects(readOutboxSummary(projectId,owner),
    /项目不存在或无权限/);
  await assert.rejects(readDeadEvents(projectId,owner),
    /项目不存在或无权限/);
  await assert.rejects(retryDeadEvent(projectId,eventId,owner,{
    idempotencyKey:randomUUID(),
  }),/项目不存在或无权限/);
  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
    [projectId,observer]);
  await assert.rejects(readDeadEvents(projectId,observer),
    /项目不存在或无权限/);
  console.log('Outbox operations: scoped snapshot, role, cross-tenant, revocation, retry versions');
}finally{
  if(projectId)await pool.query(`
    UPDATE outbox_events SET processed_at=NOW(),claimed_at=NULL,claim_token=NULL
    WHERE project_id=$1 AND processed_at IS NULL AND dead_at IS NULL`,[projectId]);
  await pool.end();
}
