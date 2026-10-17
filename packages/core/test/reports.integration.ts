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
    `WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Scheduled project') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,
    [tenant.id,user.id])).rows[0];
  const task=(await pool.query("INSERT INTO tasks(project_id,title) VALUES($1,'Task before schedule') RETURNING id",[project.id])).rows[0];
  const initialEvents=(await pool.query(
    'SELECT id,kind,before_status,after_status FROM project_task_history WHERE project_id=$1',
    [project.id])).rows;
  assert.equal(initialEvents.length,1);
  assert.equal(initialEvents[0].kind,'created');
  assert.equal(initialEvents[0].before_status,null);
  assert.equal(initialEvents[0].after_status,'todo');
  const first=await transaction(db=>generateScheduledReport(db,project.id,'week'));
  assert.equal(first,true);
  const key=periodKey(new Date(),'Asia/Shanghai','week');
  const before=(await pool.query(
    'SELECT id,content FROM reports WHERE project_id=$1 AND kind=$2 AND period_key=$3',
    [project.id,'week',key])).rows[0];
  assert.ok(before.content.includes('总数：1；'));
  assert.match(before.content,/新增任务：1；进入完成状态的任务数：0/);
  assert.ok(before.content.includes(initialEvents[0].id),
    'Every historical report entry must cite the factual transition ID');

  await pool.query("INSERT INTO tasks(project_id,title) VALUES($1,'Task after schedule')",[project.id]);
  for(const status of ['doing','blocked','done','doing']){
    await pool.query("UPDATE tasks SET status=$2,version=version+1 WHERE id=$1",[task.id,status]);
  }
  await pool.query("UPDATE tasks SET due_date='2026-11-15',version=version+1 WHERE id=$1",[task.id]);
  await pool.query("UPDATE tasks SET title=title,version=version+1 WHERE id=$1",[task.id]);
  const changes=(await pool.query(
    'SELECT id,kind,before_status,after_status,after_due_date FROM project_task_history WHERE task_id=$1 ORDER BY changed_at',
    [task.id])).rows;
  assert.equal(changes.length,6,
    'No-op task updates must not create fictitious history events');
  assert.deepEqual(changes.map(e=>e.after_status),
    ['todo','doing','blocked','done','doing','doing']);
  await assert.rejects(pool.query(
    "UPDATE project_task_history SET after_title='Forged evidence' WHERE id=$1",
    [changes[0].id]),/TASK_HISTORY_IMMUTABLE/);
  assert.equal(await transaction(db=>generateScheduledReport(db,project.id,'week')),false);
  const unchanged=(await pool.query('SELECT content FROM reports WHERE id=$1',[before.id])).rows[0].content;
  assert.equal(unchanged,before.content,'Scheduled retries must not overwrite reviewable drafts');

  const manual=await transaction(db=>generateReport(db,project.id,'week',user.id));
  assert.equal(manual.id,before.id);
  assert.ok(manual.content.includes('总数：2；'),'Manual refresh can incorporate new project facts');
  assert.match(manual.content,/新增任务：2；进入完成状态的任务数：1；重新打开的任务数：1；进入阻塞的任务数：1；期限设定\/调整次数：1/);
  assert.ok(manual.content.includes(changes[4].id),
    'Manual history contains traceable completion/reopen evidence');
  assert.match(manual.content,/本期任务历史事件总数：7/);
  const monthly=await transaction(db=>generateReport(db,project.id,'month',user.id));
  assert.match(monthly.content,/本期任务历史事件总数：7/,
    'Monthly reports must use the same factual task history');
  assert.equal(await transaction(db=>generateScheduledReport(db,project.id,'week')),false);
  assert.equal((await pool.query('SELECT content FROM reports WHERE id=$1',[before.id])).rows[0].content,
    manual.content,'Scheduled retry must preserve a manually refreshed draft');

  await pool.query("UPDATE reports SET state='published' WHERE id=$1",[before.id]);
  await pool.query("INSERT INTO tasks(project_id,title) VALUES($1,'Task after publication')",[project.id]);
  const published=await transaction(db=>generateReport(db,project.id,'week',user.id));
  assert.equal(published.content,manual.content,'Published report remains immutable');

  const another=(await pool.query(
    `WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Concurrent project') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,
    [tenant.id,user.id])).rows[0];
  // More than 100 real events: full counts, bounded evidence. Never silently
  // convert the first 100 events into an incorrect monthly total.
  await pool.query(`INSERT INTO tasks(project_id,title)
    SELECT $1,'Batch task ' || n FROM generate_series(1,110) AS n`,[another.id]);
  const results=await Promise.all(
    Array.from({length:5},()=>transaction(db=>generateScheduledReport(db,another.id,'month'))));
  assert.equal(results.filter(Boolean).length,1,'Replicated workers may only create once');
  const count=(await pool.query(
    "SELECT COUNT(*)::int AS n FROM reports WHERE project_id=$1 AND kind='month'",
    [another.id])).rows[0].n;
  assert.equal(count,1);
  const bound=(await pool.query(
    "SELECT content FROM reports WHERE project_id=$1 AND kind='month'",
    [another.id])).rows[0].content as string;
  assert.match(bound,/本期任务历史事件总数：110/);
  assert.equal((bound.match(/历史事件 ID /g)??[]).length,100,
    'Evidence list must be bounded to 100 without truncating totals');
  console.log('Reporting integration passed: one-shot schedule, human refresh, immutable publication and parallel workers');
}finally{
  await pool.end();
}
