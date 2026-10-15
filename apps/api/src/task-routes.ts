import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertProject } from '../../../packages/core/src/permissions.ts';
import { executePmCommand } from '../../../packages/core/src/pm-command.ts';
import { ensureTaskAssignee } from '../../../packages/core/src/delivery/task-assignee.ts';
import { lockTaskDependencyGraph,assertPrerequisitesCompleted } from '../../../packages/core/src/delivery/dependency-policy.ts';
import { syncFollowup } from '../../../packages/core/src/followup.ts';

const uuid=z.string().uuid();
const dateOnly=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  v=>!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
    new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,
  'Invalid calendar date');
const createSchema=z.object({
  idempotencyKey:uuid,
  title:z.string().trim().min(1).max(250),
  detail:z.string().max(5000).default(''),
  assigneeId:uuid.nullable().default(null),
  dueDate:dateOnly.nullable().default(null),
});
const updateSchema=z.object({
  idempotencyKey:uuid,version:z.number().int().positive(),
  status:z.enum(['todo','doing','blocked','done','cancelled']).optional(),
  title:z.string().trim().min(1).max(250).optional(),
  assigneeId:uuid.nullable().optional(),
  dueDate:dateOnly.nullable().optional(),
}).refine(x=>x.status!==undefined||x.title!==undefined||
  x.assigneeId!==undefined||x.dueDate!==undefined,'至少修改一个字段');
function fail(code:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode:code});
}

/** Direct Task writes use the SAME transaction receipt/event/audit contract as PM registers. */
export function registerTaskRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.post('/projects/:id/tasks',async(req,reply)=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    const v=createSchema.parse(req.body);
    const result=await executePmCommand({
      projectId,actorId,action:'task.create',
      kind:'task.created.v1',idempotencyKey:v.idempotencyKey,payload:v,
      mutate:async db=>{
        if(v.assigneeId)await ensureTaskAssignee(db,projectId,v.assigneeId);
        const {rows}=await db.query(`
          INSERT INTO tasks(project_id,title,detail,assignee_id,due_date)
          VALUES($1,$2,$3,$4,$5) RETURNING *
        `,[projectId,v.title,v.detail,v.assigneeId,v.dueDate]);
        const task=rows[0] as {id:string;version:number};
        await syncFollowup(db,projectId,task.id);
        return {response:{task},aggregateType:'tasks',aggregateId:task.id,
          aggregateVersion:task.version};
      },
    });
    return reply.code(201).send(result);
  });
  app.patch('/projects/:id/tasks/:taskId',async req=>{
    const p=req.params as {id:string;taskId:string};
    const projectId=uuid.parse(p.id),taskId=uuid.parse(p.taskId);
    const actorId=await authenticated(req);
    const v=updateSchema.parse(req.body);
    const metadata=v.title!==undefined||v.assigneeId!==undefined||v.dueDate!==undefined;
    return executePmCommand({
      projectId,actorId,action:'read',
      kind:'task.updated.v1',idempotencyKey:v.idempotencyKey,
      payload:{taskId,...v},
      mutate:async(db,role)=>{
        if(metadata)assertProject(role,'task.plan');
        // Graph lock must precede Task row lock for deadlock-safe ordering.
        if(v.status==='done')await lockTaskDependencyGraph(db,projectId);
        const current=await db.query(`
          SELECT *,due_date::text AS due_date FROM tasks
          WHERE project_id=$1 AND id=$2 FOR UPDATE
        `,[projectId,taskId]);
        const before=current.rows[0] as ({
          version:number;status:string;title:string;assignee_id:string|null;
          due_date:string|null;
        })|undefined;
        if(!before)fail(404,'任务不存在');
        if(v.status!==undefined)assertProject(role,'task.status',{
          isAssignee:before.assignee_id===actorId});
        if(before.version!==v.version)fail(409,'任务版本已更新，请刷新');
        if(role==='member')await ensureTaskAssignee(db,projectId,actorId);
        const next={
          status:v.status??before.status,
          title:v.title??before.title,
          assigneeId:v.assigneeId===undefined?before.assignee_id:v.assigneeId,
          dueDate:v.dueDate===undefined?before.due_date:v.dueDate,
        };
        if(v.status==='done'&&before.status!=='done')
          await assertPrerequisitesCompleted(db,projectId,taskId);
        // Historical completed tasks may retain a revoked user as their author.
        if(next.assigneeId&&!['done','cancelled'].includes(next.status))
          await ensureTaskAssignee(db,projectId,next.assigneeId);
        const {rows}=await db.query(`
          UPDATE tasks SET status=$3,title=$4,assignee_id=$5,due_date=$6,
            version=version+1,updated_at=NOW()
          WHERE project_id=$1 AND id=$2 RETURNING *
        `,[projectId,taskId,next.status,next.title,next.assigneeId,next.dueDate]);
        const task=rows[0] as {id:string;version:number};
        await syncFollowup(db,projectId,taskId);
        return {
          response:{task},aggregateType:'tasks',aggregateId:taskId,
          aggregateVersion:task.version,
          auditDetails:{before:{status:before.status,title:before.title,
            assigneeId:before.assignee_id,dueDate:before.due_date},
            after:next},
        };
      },
    });
  });
}
