import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../src/db.ts';
import { generateReport, generateScheduledReport } from '../src/reports.ts';
import { periodKey } from '../src/policy.ts';

const id=randomUUID();
try{
  const user=(await pool.query(
    "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Report Test','unused') RETURNING id",
    ['report-'+id+'@example.com'])).rows[0];
  const tenant=(await pool.query("INSERT INTO tenants(name) VALUES('Report Test') RETURNING id")).rows[0];
  const project=(await pool.query(
    "INSERT INTO projects(tenant_id,name,owner_id) VALUES($1,'Scheduled project',$2) RETURNING id",
    [tenant.id,user.id])).rows[0];
  await pool.query("INSERT INTO tasks(project_id,title) VALUES($1,'Task before schedule')",[project.id]);
  const first=await transaction(db=>generateScheduledReport(db,project.id,'week'));
  assert.equal(first,true);
  const key=periodKey(new Date(),'Asia/Shanghai','week');
  const before=(await pool.query(
    'SELECT id,content FROM reports WHERE project_id=$1 AND kind=$2 AND period_key=$3',
    [project.id,'week',key])).rows[0];
  assert.ok(before.content.includes('总数：1；'));

  await pool.query("INSERT INTO tasks(project_id,title) VALUES($1,'Task after schedule')",[project.id]);
  assert.equal(await transaction(db=>generateScheduledReport(db,project.id,'week')),false);
  const unchanged=(await pool.query('SELECT content FROM reports WHERE id=$1',[before.id])).rows[0].content;
  assert.equal(unchanged,before.content,'Scheduled retries must not overwrite reviewable drafts');

  const manual=await transaction(db=>generateReport(db,project.id,'week',user.id));
  assert.equal(manual.id,before.id);
  assert.ok(manual.content.includes('总数：2；'),'Manual refresh can incorporate new project facts');
  assert.equal(await transaction(db=>generateScheduledReport(db,project.id,'week')),false);
  assert.equal((await pool.query('SELECT content FROM reports WHERE id=$1',[before.id])).rows[0].content,
    manual.content,'Scheduled retry must preserve a manually refreshed draft');

  await pool.query("UPDATE reports SET state='published' WHERE id=$1",[before.id]);
  await pool.query("INSERT INTO tasks(project_id,title) VALUES($1,'Task after publication')",[project.id]);
  const published=await transaction(db=>generateReport(db,project.id,'week',user.id));
  assert.equal(published.content,manual.content,'Published report remains immutable');

  const another=(await pool.query(
    "INSERT INTO projects(tenant_id,name,owner_id) VALUES($1,'Concurrent project',$2) RETURNING id",
    [tenant.id,user.id])).rows[0];
  const results=await Promise.all(
    Array.from({length:5},()=>transaction(db=>generateScheduledReport(db,another.id,'month'))));
  assert.equal(results.filter(Boolean).length,1,'Replicated workers may only create once');
  const count=(await pool.query(
    "SELECT COUNT(*)::int AS n FROM reports WHERE project_id=$1 AND kind='month'",
    [another.id])).rows[0].n;
  assert.equal(count,1);
  console.log('Reporting integration passed: one-shot schedule, human refresh, immutable publication and parallel workers');
}finally{
  await pool.end();
}
