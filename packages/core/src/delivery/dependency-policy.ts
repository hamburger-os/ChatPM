import type { DbClient } from '../db.ts';

/**
 * The same project graph advisory lock guards adding dependencies and
 * completing their dependents, preventing a concurrent TOCTOU violation.
 */
export async function lockTaskDependencyGraph(db:DbClient,projectId:string):Promise<void>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['pm-dependencies:'+projectId]);
}
export async function assertPrerequisitesCompleted(
  db:DbClient,projectId:string,taskId:string,
):Promise<void>{
  const {rows}=await db.query<{id:string}>(`
    SELECT pre.id FROM task_dependencies d
    JOIN tasks pre ON pre.project_id=d.project_id AND pre.id=d.prerequisite_task_id
    WHERE d.project_id=$1 AND d.dependent_task_id=$2 AND pre.status<>'done'
    LIMIT 1
  `,[projectId,taskId]);
  if(rows.length)throw Object.assign(
    new Error('存在未完成的前置任务，请先完成或调整依赖关系'),
    {statusCode:409});
}
