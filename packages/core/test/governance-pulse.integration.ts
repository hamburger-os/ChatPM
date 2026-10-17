import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {getGovernancePulse,aggregateGovernancePulse} from '../src/governance/pulse.ts';

const suffix=randomUUID();
try{
  const createUser=async(role:string)=>{
    const {rows}=await pool.query<{id:string}>(
      "INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,'unused') RETURNING id",
      [role+'-'+suffix+'@example.test',role]);
    return rows[0].id;
  };
  const owner=await createUser('governance-owner');
  const member=await createUser('governance-member');
  const outsider=await createUser('governance-outsider');
  const tenant=(await pool.query<{id:string}>(
    "INSERT INTO tenants(name) VALUES('Pulse test') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin'),($1,$3,'member')",
    [tenant,owner,member]);
  const portfolio=(await pool.query<{id:string}>(`
    INSERT INTO portfolios(tenant_id,name) VALUES($1,'Main Portfolio') RETURNING id`,
    [tenant])).rows[0].id;
  const emptyPortfolio=(await pool.query<{id:string}>(`
    INSERT INTO portfolios(tenant_id,name) VALUES($1,'Empty Portfolio') RETURNING id`,
    [tenant])).rows[0].id;
  const program=(await pool.query<{id:string}>(`
    INSERT INTO programs(tenant_id,name,portfolio_id)
    VALUES($1,'Program 1',$2) RETURNING id`,
    [tenant,portfolio])).rows[0].id;
  const independentProgram=(await pool.query<{id:string}>(`
    INSERT INTO programs(tenant_id,name) VALUES($1,'Independent Program') RETURNING id`,
    [tenant])).rows[0].id;
  const project=async(name:string,programId:string|null,portfolioId:string|null)=>{
    const {rows}=await pool.query<{id:string}>(`
      WITH created AS (
      INSERT INTO projects(tenant_id,name,program_id,portfolio_id)
      VALUES($1,$3,$4,$5) RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,
      [tenant,owner,name,programId,portfolioId]);
    return rows[0].id;
  };
  const p1=await project('A',program,null);
  const p2=await project('B',program,null);
  const p3=await project('C',null,portfolio);
  const p4=await project('D',null,null);
  const p5=await project('E',independentProgram,null);
  const task=async(pid:string,status:string,due:string|null)=>{
    await pool.query(`INSERT INTO tasks(project_id,title,status,due_date)
      VALUES($1,'Pulse task',$2,$3)`,[pid,status,due]);
  };
  await task(p1,'done',null);
  await task(p1,'blocked','2026-10-13');
  await task(p2,'todo','2026-10-20');
  await task(p3,'cancelled','2026-10-10');
  await task(p4,'doing','2026-10-15');
  await pool.query(`INSERT INTO risks(project_id,title,status) VALUES
    ($1,'Open risk','open'),($2,'Resolved risk','resolved')`,[p2,p3]);
  for(const [pid,percentage,from,to,cancelled] of [
    [p1,30,'2026-10-16','2026-10-18',false],
    [p2,40,'2026-10-16','2026-10-18',false],
    [p3,20,'2026-10-16','2026-10-18',false],
    [p4,100,'2026-10-16','2026-10-18',true],
    [p5,35,'2026-10-20','2026-10-30',false],
  ] as const){
    await pool.query(`
      INSERT INTO resource_allocations(tenant_id,project_id,user_id,percentage,
        start_date,end_date,cancelled_at,cancelled_by)
      VALUES($1,$2,$3,$4,$5,$6,
        CASE WHEN $7 THEN NOW() ELSE NULL END,
        CASE WHEN $7 THEN $3::uuid ELSE NULL END)
    `,[tenant,pid,owner,percentage,from,to,cancelled]);
  }
  const current=await getGovernancePulse(tenant,owner,'2026-10-16');
  assert.equal(current.totals.project_count,5);
  assert.equal(current.totals.tasks_total,5);
  assert.equal(current.totals.tasks_done,1);
  assert.equal(current.totals.tasks_cancelled,1);
  assert.equal(current.totals.tasks_overdue,2);
  assert.equal(current.totals.tasks_blocked,1);
  assert.equal(current.totals.risks_open,1);
  assert.equal(current.totals.planned_percentage_points,90);
  assert.equal(current.portfolios.find(x=>x.id===portfolio)?.project_count,3,
    'Portfolio includes program descendants and direct projects exactly once');
  assert.equal(current.portfolios.find(x=>x.id===emptyPortfolio)?.project_count,0);
  assert.equal(current.programs.find(x=>x.id===program)?.project_count,2);
  assert.equal(current.programs.find(x=>x.id===independentProgram)?.project_count,1);
  assert.deepEqual(current.unassigned_projects.map(x=>x.id),[p4]);
  assert.equal(current.resources.length,1);
  assert.equal(current.resources[0].project_count,3);
  assert.equal(current.resources[0].planned_percentage,90);
  assert.equal(current.resources[0].capacity_status,'near_capacity');
  const later=await getGovernancePulse(tenant,owner,'2026-10-21');
  assert.equal(later.totals.project_count,5,'Selected future date must not invent a new project');
  assert.equal(later.totals.planned_percentage_points,35,
    'Cancelled and completed allocation intervals are excluded');
  assert.equal(later.totals.tasks_overdue,3,'Deadline filtering uses the selected date');
  assert.equal(later.totals.tasks_done,1,'Current status is not falsified as historical state');
  await assert.rejects(getGovernancePulse(tenant,member,'2026-10-16'),
    /仅当前组织管理员可查看经营汇总/);
  await assert.rejects(getGovernancePulse(tenant,outsider,'2026-10-16'),
    /仅当前组织管理员可查看经营汇总/);
  const other=(await pool.query<{id:string}>(
    "INSERT INTO tenants(name) VALUES('Different Pulse Tenant') RETURNING id")).rows[0].id;
  await assert.rejects(getGovernancePulse(other,owner,'2026-10-16'),
    /仅当前组织管理员可查看经营汇总/);
  assert.equal(aggregateGovernancePulse([],[],[],[]).totals.project_count,0);
  console.log('Governance pulse integration passed: no double count, tenant admin auth, cancelled allocation, date semantics');
}finally{
  await pool.end();
}
