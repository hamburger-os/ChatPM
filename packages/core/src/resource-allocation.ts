import type {DbClient} from './db.ts';

export type AllocationRequest={
  tenantId:string;projectId:string;userId:string;percentage:number;
  startDate:string;endDate:string;
};
function deny(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}

/** Record capacity across all projects and departments in the same tenant.
 * The caller MUST hold the tenant-governance advisory transaction lock before
 * checking availability and inserting the allocation. Different idempotent
 * commands cannot race between these statements.
 *
 * Daily totals change only on existing allocation start/end boundaries.
 * For a NEW interval, the highest existing total must occur at the new start
 * or at an existing allocation start inside that interval. No generate_series
 * over arbitrary time ranges is required.
 */
export async function recordResourceAllocation(db:DbClient,request:AllocationRequest):
  Promise<{id:string}>{
  const {tenantId,projectId,userId,percentage,startDate,endDate}=request;
  const eligible=await db.query(`
    SELECT 1 FROM projects p
    JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$3
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$3
    WHERE p.tenant_id=$1 AND p.id=$2
    FOR SHARE OF p,pm,tm
  `,[tenantId,projectId,userId]);
  if(!eligible.rowCount)
    deny(400,'资源只能分配给本组织内已加入该项目的成员');

  const result=await db.query<{peak:number}>(`
    WITH boundaries AS (
      SELECT $3::date AS day
      UNION
      SELECT a.start_date AS day FROM resource_allocations a
      WHERE a.tenant_id=$1 AND a.user_id=$2
        AND a.start_date BETWEEN $3::date AND $4::date
    ), usage AS (
      SELECT b.day, COALESCE(SUM(a.percentage),0)::int AS used
      FROM boundaries b
      LEFT JOIN resource_allocations a
        ON a.tenant_id=$1 AND a.user_id=$2
        AND a.start_date<=b.day AND a.end_date>=b.day
      GROUP BY b.day
    )
    SELECT COALESCE(MAX(used),0)::int AS peak FROM usage
  `,[tenantId,userId,startDate,endDate]);
  if(result.rows[0].peak+percentage>100)
    deny(409,'该人员在所选日期的跨项目总投入将超过100%，请调整投入比例或日期');

  const added=await db.query<{id:string}>(`
    INSERT INTO resource_allocations
      (tenant_id,project_id,user_id,percentage,start_date,end_date)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id
  `,[tenantId,projectId,userId,percentage,startDate,endDate]);
  return {id:added.rows[0].id};
}
