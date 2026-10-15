import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from '../../../packages/core/src/db.ts';
import {generateReport} from '../../../packages/core/src/reports.ts';
import {executePmCommand} from '../../../packages/core/src/pm-command.ts';

const uuid=z.string().uuid();
const generateSchema=z.object({
  idempotencyKey:uuid,kind:z.enum(['week','month']),
});
const publishSchema=z.object({
  idempotencyKey:uuid,expectedRevision:z.number().int().positive(),
});
function fail(statusCode:number,message:string):never {
  throw Object.assign(new Error(message),{statusCode});
}

/** Report reads and user-issued writes share project scoping; official writes
 * use transaction-scoped authorization, receipts, audit and domain outbox.
 */
export function registerReportRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void {
  app.get('/projects/:id/reports',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    const access=await pool.query(`
      SELECT 1 FROM projects p
      JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
      JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$2
      WHERE p.id=$1
    `,[projectId,actorId]);
    if(!access.rowCount)fail(404,'项目不存在或无权限');
    return {reports:(await pool.query(`
      SELECT * FROM reports WHERE project_id=$1
      ORDER BY created_at DESC LIMIT 50
    `,[projectId])).rows};
  });
  app.post('/projects/:id/reports',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    const v=generateSchema.parse(req.body);
    return executePmCommand({
      projectId,actorId,action:'report.manage',
      kind:'report.generation_requested.v1',
      idempotencyKey:v.idempotencyKey,payload:v,
      mutate:async db=>{
        const report=await generateReport(db,projectId,v.kind,actorId);
        if(!report)fail(404,'项目报告不存在');
        return {response:{report},
          aggregateType:'reports',aggregateId:report.id,
          aggregateVersion:Number(report.revision),
          auditDetails:{kind:v.kind,periodKey:report.period_key,
            unchangedPublished:report.state==='published'},
        };
      },
    });
  });
  app.post('/projects/:id/reports/:reportId/publish',async req=>{
    const p=req.params as {id:string;reportId:string};
    const projectId=uuid.parse(p.id),reportId=uuid.parse(p.reportId);
    const actorId=await authenticated(req);
    const v=publishSchema.parse(req.body);
    return executePmCommand({
      projectId,actorId,action:'report.manage',
      kind:'report.published.v1',idempotencyKey:v.idempotencyKey,
      payload:{reportId,...v},
      mutate:async db=>{
        const updated=await db.query(`
          UPDATE reports SET state='published',
            published_at=NOW(),published_by=$4,revision=revision+1
          WHERE project_id=$1 AND id=$2 AND state='draft' AND revision=$3
          RETURNING *
        `,[projectId,reportId,v.expectedRevision,actorId]);
        const report=updated.rows[0];
        if(!report){
          const found=await db.query(
            'SELECT 1 FROM reports WHERE project_id=$1 AND id=$2',
            [projectId,reportId]);
          if(!found.rowCount)fail(404,'报告不存在或不属于当前项目');
          fail(409,'报告已发布或版本已更新，请刷新');
        }
        return {response:{ok:true,report},
          aggregateType:'reports',aggregateId:reportId,
          aggregateVersion:Number(report.revision),
          auditDetails:{kind:report.kind,periodKey:report.period_key,
            publishedAt:report.published_at},
        };
      },
    });
  });
}
