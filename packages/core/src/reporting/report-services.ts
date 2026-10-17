import {transaction} from '../db.ts';
import {lockProjectAccess} from '../identity/project-access.ts';
import {executePmCommand} from '../pm-command.ts';
import {generateReport} from '../reports.ts';

function fail(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}

/** A single authorized read snapshot prevents a membership revocation
 * between the HTTP permission check and the report contents query.
 */
export async function listProjectReports(projectId:string,actorId:string){
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await lockProjectAccess(db,projectId,actorId);
    const {rows}=await db.query(`
      SELECT * FROM reports WHERE project_id=$1
      ORDER BY created_at DESC,id DESC LIMIT 50`,[projectId]);
    return {reports:rows};
  });
}

type GenerateInput={
  idempotencyKey:string;kind:'week'|'month';
};
/** Official reporting commands reuse the project command runtime and the
 * existing report snapshot generator: no independent reporting ledger.
 */
export async function requestProjectReport(
  projectId:string,actorId:string,v:GenerateInput,
){
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
}

type PublishInput={idempotencyKey:string;expectedRevision:number};
export async function publishProjectReport(
  projectId:string,reportId:string,actorId:string,v:PublishInput,
){
  return executePmCommand({
    projectId,actorId,action:'report.manage',
    kind:'report.published.v1',
    idempotencyKey:v.idempotencyKey,payload:{reportId,...v},
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
}
