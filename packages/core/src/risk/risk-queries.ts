import {transaction} from '../db.ts';
import {lockProjectAccess} from '../identity/project-access.ts';
import {assertProject} from '../permissions.ts';

function missing():never{
  throw Object.assign(new Error('风险不存在'),{statusCode:404});
}
async function scope(
  db:import('../db.ts').DbClient,projectId:string,actorId:string,
){
  const member=await lockProjectAccess(db,projectId,actorId);
  assertProject(member.role,'read');
}

/** Every Risk read uses the same membership-locked MVCC snapshot as its data. */
export async function listProjectRisks(projectId:string,actorId:string){
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await scope(db,projectId,actorId);
    const {rows}=await db.query(`
      SELECT * FROM risks WHERE project_id=$1
      ORDER BY created_at DESC LIMIT 200
    `,[projectId]);
    return {risks:rows};
  });
}
export async function readRiskHistory(
  projectId:string,riskId:string,actorId:string,beforeVersion?:number,
){
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await scope(db,projectId,actorId);
    const exists=await db.query(`
      SELECT 1 FROM risks WHERE project_id=$1 AND id=$2 FOR KEY SHARE
    `,[projectId,riskId]);
    if(!exists.rowCount)missing();
    const {rows}=await db.query<{
      id:string;risk_version:number;action:string;from_status:string;
      to_status:string;note:string;actor_id:string;occurred_at:Date;
    }>(`
      SELECT id,risk_version,action,from_status,to_status,note,actor_id,occurred_at
      FROM risk_register_changes
      WHERE project_id=$1 AND risk_id=$2
        AND risk_version<COALESCE($3::int,2147483647)
      ORDER BY risk_version DESC LIMIT 51
    `,[projectId,riskId,beforeVersion??null]);
    return {history:rows.slice(0,50),
      nextBeforeVersion:rows.length>50?rows[49].risk_version:null};
  });
}
