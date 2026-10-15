import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getTaskHistoryEntry, listTaskHistory } from '../../../packages/core/src/reporting/task-history.ts';
import { createTask, updateTask } from '../../../packages/core/src/delivery/task-commands.ts';

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
/** Direct Task writes use the SAME transaction receipt/event/audit contract as PM registers. */
export function registerTaskRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  // Historical evidence remains readable to current project+tenant members
  // only; task and event IDs must both match the same project.
  app.get('/projects/:id/tasks/:taskId/history',async req=>{
    const p=req.params as {id:string;taskId:string};
    const projectId=uuid.parse(p.id),taskId=uuid.parse(p.taskId);
    const actorId=await authenticated(req);
    const cursor=z.object({
      beforeAt:z.string().datetime({offset:true}).optional(),
      beforeId:uuid.optional(),
    }).refine(v=>(v.beforeAt===undefined)===(v.beforeId===undefined),{
      message:'分页游标必须同时包含时间和 ID',
    }).parse(req.query);
    return listTaskHistory(projectId,taskId,actorId,cursor);
  });
  app.get('/projects/:id/tasks/:taskId/history/:eventId',async req=>{
    const p=req.params as {id:string;taskId:string;eventId:string};
    const projectId=uuid.parse(p.id),taskId=uuid.parse(p.taskId);
    const eventId=uuid.parse(p.eventId),actorId=await authenticated(req);
    return getTaskHistoryEntry(projectId,taskId,eventId,actorId);
  });
  app.post('/projects/:id/tasks',async(req,reply)=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    const input=createSchema.parse(req.body);
    return reply.code(201).send(await createTask(projectId,actorId,input));
  });
  app.patch('/projects/:id/tasks/:taskId',async req=>{
    const p=req.params as {id:string;taskId:string};
    const projectId=uuid.parse(p.id),taskId=uuid.parse(p.taskId);
    const actorId=await authenticated(req);
    const input=updateSchema.parse(req.body);
    return updateTask(projectId,taskId,actorId,input);
  });
}
