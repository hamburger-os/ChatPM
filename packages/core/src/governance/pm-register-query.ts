import { transaction } from '../db.ts';
import { lockProjectAccess } from '../identity/project-access.ts';

// This read-model owns the same fixed set of formal PM registers as the
// command endpoints. No user input can ever become an SQL table name.
const registers={
  goals:'project_goals',
  milestones:'project_milestones',
  deliverables:'project_deliverables',
  issues:'project_issues',
  decisions:'project_decisions',
  changes:'project_change_requests',
} as const;

/** One revocation-protected snapshot across all PM registers. */
export async function listPmRegisters(projectId:string,actorId:string){
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await lockProjectAccess(db,projectId,actorId);
    const result:Record<string,unknown[]>= {};
    for(const [name,table] of Object.entries(registers)){
      const order=table==='project_decisions'?'decided_at':'created_at';
      const {rows}=await db.query(
        `SELECT * FROM ${table} WHERE project_id=$1 ORDER BY ${order} DESC LIMIT 100`,
        [projectId]);
      result[name]=rows;
    }
    return result;
  });
}
