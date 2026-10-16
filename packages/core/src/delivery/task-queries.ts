import {transaction} from '../db.ts';
import {lockProjectAccess} from '../identity/project-access.ts';

/** Return one consistent, authorized project snapshot.
 * An archive never grants broader access than the active task list.
 */
export async function listProjectTasks(
  projectId:string,actorId:string,archived:boolean,
){
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await lockProjectAccess(db,projectId,actorId);
    const {rows}=await db.query(`
      SELECT t.*,t.due_date::text AS due_date,u.display_name AS assignee
      FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.project_id=$1 AND (t.archived_at IS NOT NULL)=$2::boolean
      ORDER BY t.created_at DESC,t.id DESC LIMIT 300`,
      [projectId,archived]);
    return {tasks:rows};
  });
}
