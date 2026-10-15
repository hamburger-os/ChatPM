import {transaction} from '../db.ts';

type ProjectPulse={
  id:string;name:string;department_id:string|null;
  program_id:string|null;portfolio_id:string|null;
  effective_portfolio_id:string|null;
  tasks_total:number;tasks_done:number;tasks_cancelled:number;tasks_blocked:number;
  tasks_overdue:number;risks_open:number;planned_percentage_points:number;
};
type Program={id:string;name:string;portfolio_id:string|null};
type Portfolio={id:string;name:string};
type ResourceLoad={
  user_id:string;display_name:string;email:string;
  planned_percentage:number;project_count:number;
};
type Metrics={
  project_count:number;tasks_total:number;tasks_done:number;tasks_cancelled:number;
  tasks_blocked:number;tasks_overdue:number;risks_open:number;
  planned_percentage_points:number;
};
const empty=():Metrics=>({
  project_count:0,tasks_total:0,tasks_done:0,tasks_cancelled:0,
  tasks_blocked:0,tasks_overdue:0,risks_open:0,
  planned_percentage_points:0,
});
function add(into:Metrics,p:ProjectPulse){
  into.project_count++;
  for(const key of ['tasks_total','tasks_done','tasks_cancelled','tasks_blocked',
    'tasks_overdue','risks_open','planned_percentage_points'] as const)
    into[key]+=p[key];
}
export function aggregateGovernancePulse(
  projects:ProjectPulse[],programs:Program[],portfolios:Portfolio[],
  resourceLoads:ResourceLoad[],
){
  const root=empty();
  const byProgram=programs.map(program=>({...program,...empty()}));
  const byPortfolio=portfolios.map(portfolio=>({...portfolio,...empty()}));
  const programMap=new Map(byProgram.map(x=>[x.id,x]));
  const portfolioMap=new Map(byPortfolio.map(x=>[x.id,x]));
  const unattributed:ProjectPulse[]=[];
  for(const project of projects){
    add(root,project);
    if(project.program_id){
      const group=programMap.get(project.program_id);
      if(!group)throw new Error('GOVERNANCE_PROGRAM_MISSING');
      add(group,project);
    }
    if(project.effective_portfolio_id){
      const group=portfolioMap.get(project.effective_portfolio_id);
      if(!group)throw new Error('GOVERNANCE_PORTFOLIO_MISSING');
      // Exactly one effective portfolio for every project. A project reached
      // through its program is not added again through a direct portfolio.
      add(group,project);
    }else if(!project.program_id)unattributed.push(project);
  }
  return {
    totals:root,
    programs:byProgram,
    portfolios:byPortfolio,
    unassigned_projects:unattributed,
    projects,
    resources:resourceLoads.map(r=>({
      ...r,capacity_status:r.planned_percentage>100?'overallocated':
        r.planned_percentage>=80?'near_capacity':'within_capacity',
    })),
  };
}
function deny():never{
  throw Object.assign(new Error('仅当前组织管理员可查看经营汇总'),{statusCode:403});
}

/**
 * Read-only tenant administration snapshot. The selected date applies to
 * deadlines and planned allocations, NEVER a replay of historical task status.
 * One REPEATABLE READ transaction keeps all entity/category totals consistent,
 * and the membership SHARE lock prevents concurrent tenant-admin revocation.
 */
export async function getGovernancePulse(tenantId:string,actorId:string,onDate:string){
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const member=await db.query<{role:string}>(`
      SELECT role FROM tenant_members
      WHERE tenant_id=$1 AND user_id=$2 FOR SHARE`,[tenantId,actorId]);
    if(member.rows[0]?.role!=='admin')deny();
    const [projects,programs,portfolios,resources]=await Promise.all([
      // pg PoolClient does not multiplex statements across a transaction;
      // each query still uses the same transaction snapshot on this client.
      db.query<ProjectPulse>(`
        SELECT p.id,p.name,p.department_id,p.program_id,p.portfolio_id,
          COALESCE(g.portfolio_id,p.portfolio_id) AS effective_portfolio_id,
          ts.tasks_total,ts.tasks_done,ts.tasks_cancelled,ts.tasks_blocked,ts.tasks_overdue,
          rs.risks_open,als.planned_percentage_points
        FROM projects p
        LEFT JOIN programs g ON g.tenant_id=p.tenant_id AND g.id=p.program_id
        CROSS JOIN LATERAL (
          SELECT COUNT(*)::int AS tasks_total,
            COUNT(*) FILTER(WHERE t.status='done')::int AS tasks_done,
            COUNT(*) FILTER(WHERE t.status='cancelled')::int AS tasks_cancelled,
            COUNT(*) FILTER(WHERE t.status='blocked')::int AS tasks_blocked,
            COUNT(*) FILTER(WHERE t.due_date<$2::date
              AND t.status NOT IN ('done','cancelled'))::int AS tasks_overdue
          FROM tasks t WHERE t.project_id=p.id
        ) ts
        CROSS JOIN LATERAL (
          SELECT COUNT(*) FILTER(WHERE r.status<>'resolved')::int AS risks_open
          FROM risks r WHERE r.project_id=p.id
        ) rs
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(a.percentage),0)::int AS planned_percentage_points
          FROM resource_allocations a WHERE a.tenant_id=p.tenant_id
            AND a.project_id=p.id AND a.cancelled_at IS NULL
            AND a.start_date<=$2::date AND a.end_date>=$2::date
        ) als
        WHERE p.tenant_id=$1 ORDER BY p.name,p.id`,[tenantId,onDate]),
      db.query<Program>('SELECT id,name,portfolio_id FROM programs WHERE tenant_id=$1 ORDER BY name,id',[tenantId]),
      db.query<Portfolio>('SELECT id,name FROM portfolios WHERE tenant_id=$1 ORDER BY name,id',[tenantId]),
      db.query<ResourceLoad>(`
        SELECT u.id AS user_id,u.display_name,u.email,
          SUM(a.percentage)::int AS planned_percentage,
          COUNT(DISTINCT a.project_id)::int AS project_count
        FROM resource_allocations a
        JOIN users u ON u.id=a.user_id
        JOIN tenant_members tm ON tm.tenant_id=a.tenant_id AND tm.user_id=a.user_id
        WHERE a.tenant_id=$1 AND a.cancelled_at IS NULL
          AND a.start_date<=$2::date AND a.end_date>=$2::date
        GROUP BY u.id,u.display_name,u.email
        ORDER BY planned_percentage DESC,u.id`,[tenantId,onDate]),
    ]);
    return {
      as_of_date:onDate,generated_at:new Date().toISOString(),
      ...aggregateGovernancePulse(
        projects.rows,programs.rows,portfolios.rows,resources.rows),
    };
  });
}
