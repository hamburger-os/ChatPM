import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, type DbClient } from '../../../packages/core/src/db.ts';
import { executePmCommand, type PmMutation } from '../../../packages/core/src/pm-command.ts';
import { assertProject, type ProjectAction, type ProjectRole } from '../../../packages/core/src/permissions.ts';

const uuid=z.string().uuid();
const title=z.string().trim().min(1).max(250);
const longText=z.string().trim().min(1).max(5000);
const date=z.string().date();
const key={idempotencyKey:uuid};
const definitions={
  goals:{
    table:'project_goals',actorColumn:'created_by',action:'pm.plan' as ProjectAction,
    schema:z.object({...key,title,description:z.string().max(5000).default(''),
      successCriteria:z.string().trim().min(1).max(3000)}),
    fields:[['title','title'],['description','description'],['success_criteria','successCriteria']],
  },
  milestones:{
    table:'project_milestones',actorColumn:'created_by',action:'pm.plan' as ProjectAction,
    schema:z.object({...key,title,dueDate:date,goalId:uuid.nullable().default(null)}),
    fields:[['title','title'],['due_date','dueDate'],['goal_id','goalId']],
  },
  deliverables:{
    table:'project_deliverables',actorColumn:'created_by',action:'pm.plan' as ProjectAction,
    schema:z.object({...key,title,acceptanceCriteria:z.string().trim().min(1).max(3000),
      assigneeId:uuid, milestoneId:uuid.nullable().default(null),
      dueDate:date.nullable().default(null)}),
    fields:[['title','title'],['acceptance_criteria','acceptanceCriteria'],
      ['assignee_id','assigneeId'],['milestone_id','milestoneId'],['due_date','dueDate']],
  },
  issues:{
    table:'project_issues',actorColumn:'created_by',action:'pm.plan' as ProjectAction,
    schema:z.object({...key,title,detail:z.string().max(5000).default(''),
      severity:z.enum(['low','medium','high','critical']),
      ownerId:uuid.nullable().default(null)}),
    fields:[['title','title'],['detail','detail'],['severity','severity'],['owner_id','ownerId']],
  },
  decisions:{
    table:'project_decisions',actorColumn:'decided_by',action:'pm.plan' as ProjectAction,
    schema:z.object({...key,title,rationale:longText}),
    fields:[['title','title'],['rationale','rationale']],
  },
  changes:{
    table:'project_change_requests',actorColumn:'created_by',action:'pm.plan' as ProjectAction,
    schema:z.object({...key,title,rationale:longText,impact:longText}),
    fields:[['title','title'],['rationale','rationale'],['impact','impact']],
  },
} as const;
const entryKind=z.enum(['goals','milestones','deliverables','issues','decisions','changes']);

function fail(code:number,message:string):never {
  throw Object.assign(new Error(message),{statusCode:code});
}
function context(req:FastifyRequest){
  return uuid.parse((req.params as {projectId:string}).projectId);
}
type Mutation=PmMutation<{item:Record<string,unknown>}>;

export function registerPmRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.get('/projects/:projectId/pm',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const access=await pool.query(`SELECT 1 FROM project_members pm
      JOIN projects p ON p.id=pm.project_id
      JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
      WHERE pm.project_id=$1 AND pm.user_id=$2`,[projectId,user]);
    if(!access.rowCount)fail(404,'项目不存在或无权限');
    const names=entryKind.options;
    const tables=names.map(name=>definitions[name].table);
    const lists=await Promise.all(tables.map(table=>
      pool.query(`SELECT * FROM ${table} WHERE project_id=$1
        ORDER BY ${table==='project_decisions'?'decided_at':'created_at'} DESC LIMIT 100`,[projectId])));
    return Object.fromEntries(names.map((name,i)=>[name,lists[i].rows]));
  });

  app.post('/projects/:projectId/pm/:kind',async (req,reply)=>{
    const projectId=context(req),kind=entryKind.parse((req.params as {kind:string}).kind);
    const user=await authenticated(req),spec=definitions[kind];
    const input=spec.schema.parse(req.body) as Record<string,unknown>;
    const fields=spec.fields as ReadonlyArray<readonly [string,string]>;
    const columns=['project_id',spec.actorColumn,...fields.map(x=>x[0])];
    const params=[projectId,user,...fields.map(x=>input[x[1]])];
    const result=await executePmCommand({
      projectId,actorId:user,idempotencyKey:input.idempotencyKey as string,
      kind:'pm.'+kind+'.created.v1',action:spec.action,payload:input,
      mutate:async db=>{
        // Names and columns are fixed by the in-process specification.
        const sql=`INSERT INTO ${spec.table} (${columns.join(',')})
          VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`;
        const {rows}=await db.query(sql,params);
        const item=rows[0] as Record<string,unknown>;
        return {response:{item},aggregateType:kind,aggregateId:item.id as string,
          aggregateVersion:Number(item.version??1)} satisfies Mutation;
      },
    });
    return reply.code(201).send(result);
  });

  const versioned=z.object({idempotencyKey:uuid,expectedVersion:z.number().int().positive()});
  app.post('/projects/:projectId/pm/deliverables/:itemId/submit',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=versioned.parse(req.body);
    return executePmCommand({
      projectId,actorId:user,idempotencyKey:input.idempotencyKey,
      action:'read',kind:'pm.deliverable.submitted.v1',payload:{id,...input},
      mutate:async (db,role)=>{
        const r=await db.query(`SELECT * FROM project_deliverables
          WHERE project_id=$1 AND id=$2 FOR UPDATE`,[projectId,id]);
        const item=r.rows[0];
        if(!item)fail(404,'交付物不存在');
        // Only the actual assignee can submit a deliverable for review.
        if(item.assignee_id!==user)fail(403,'只有交付物负责人可以提交验收');
        assertProject(role,'pm.submit',{isAssignee:true});
        if(item.version!==input.expectedVersion)fail(409,'交付物版本冲突');
        if(!['planned','returned'].includes(item.status))fail(409,'当前状态不可重复提交验收');
        const update=await db.query(`UPDATE project_deliverables SET
          status='submitted',submitted_by=$3,submitted_at=NOW(),
          reviewed_by=NULL,reviewed_at=NULL,version=version+1
          WHERE project_id=$1 AND id=$2 RETURNING *`,[projectId,id,user]);
        const changed=update.rows[0];
        return {response:{item:changed},aggregateType:'deliverables',
          aggregateId:id,aggregateVersion:changed.version};
      },
    });
  });

  const reviewSchema=versioned.extend({decision:z.enum(['accept','return'])});
  app.post('/projects/:projectId/pm/deliverables/:itemId/review',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=reviewSchema.parse(req.body);
    return executePmCommand({
      projectId,actorId:user,idempotencyKey:input.idempotencyKey,
      action:'pm.accept',kind:'pm.deliverable.reviewed.v1',payload:{id,...input},
      mutate:async db=>{
        const r=await db.query(`SELECT * FROM project_deliverables
          WHERE project_id=$1 AND id=$2 FOR UPDATE`,[projectId,id]);
        const item=r.rows[0];
        if(!item)fail(404,'交付物不存在');
        if(item.version!==input.expectedVersion)fail(409,'交付物版本冲突');
        if(item.status!=='submitted')fail(409,'仅待验收交付物可审核');
        if(item.submitted_by===user)fail(403,'不可审核自己的交付成果');
        const update=await db.query(`UPDATE project_deliverables SET
          status=$3,reviewed_by=$4,reviewed_at=NOW(),version=version+1
          WHERE project_id=$1 AND id=$2 RETURNING *`,
          [projectId,id,input.decision==='accept'?'accepted':'returned',user]);
        const changed=update.rows[0];
        return {response:{item:changed},aggregateType:'deliverables',
          aggregateId:id,aggregateVersion:changed.version};
      },
    });
  });

  const decisionSchema=versioned.extend({decision:z.enum(['approve','reject'])});
  app.post('/projects/:projectId/pm/changes/:itemId/decide',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=decisionSchema.parse(req.body);
    return executePmCommand({
      projectId,actorId:user,idempotencyKey:input.idempotencyKey,
      action:'pm.approve',kind:'pm.change.decided.v1',payload:{id,...input},
      mutate:async db=>{
        const r=await db.query(`SELECT * FROM project_change_requests
          WHERE project_id=$1 AND id=$2 FOR UPDATE`,[projectId,id]);
        const item=r.rows[0];
        if(!item)fail(404,'变更申请不存在');
        if(item.version!==input.expectedVersion)fail(409,'变更申请版本冲突');
        if(item.status!=='pending')fail(409,'已处理变更不可重复审批');
        if(item.created_by===user)fail(403,'申请人不可自批重大变更');
        const update=await db.query(`UPDATE project_change_requests SET
          status=$3,decided_by=$4,decided_at=NOW(),version=version+1
          WHERE project_id=$1 AND id=$2 RETURNING *`,
          [projectId,id,input.decision==='approve'?'approved':'rejected',user]);
        const changed=update.rows[0];
        return {response:{item:changed},aggregateType:'changes',
          aggregateId:id,aggregateVersion:changed.version};
      },
    });
  });

  const dependencySchema=z.object({
    idempotencyKey:uuid,dependentTaskId:uuid,prerequisiteTaskId:uuid,
  }).refine(x=>x.dependentTaskId!==x.prerequisiteTaskId,'任务不能依赖自身');
  app.get('/projects/:projectId/pm/dependencies',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const authorized=await pool.query(`SELECT 1 FROM project_members pm
      JOIN projects p ON p.id=pm.project_id
      JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
      WHERE pm.project_id=$1 AND pm.user_id=$2`,[projectId,user]);
    if(!authorized.rowCount)fail(404,'项目不存在或无权限');
    const {rows}=await pool.query(`SELECT * FROM task_dependencies
      WHERE project_id=$1 ORDER BY created_at DESC LIMIT 250`,[projectId]);
    return {dependencies:rows};
  });
  app.post('/projects/:projectId/pm/dependencies',async(req,reply)=>{
    const projectId=context(req),user=await authenticated(req);
    const input=dependencySchema.parse(req.body);
    const result=await executePmCommand({
      projectId,actorId:user,idempotencyKey:input.idempotencyKey,
      action:'pm.plan',kind:'pm.dependency.created.v1',payload:input,
      mutate:async(db:DbClient)=>{
        // Lock the entire project's graph, preventing concurrent cycle creation.
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          ['pm-dependencies:'+projectId]);
        const known=await db.query(`SELECT id FROM tasks WHERE project_id=$1
          AND id=ANY($2::uuid[]) FOR KEY SHARE`,
          [projectId,[input.dependentTaskId,input.prerequisiteTaskId]]);
        if(known.rows.length!==2)fail(404,'任务必须都属于同一项目');
        const cycle=await db.query(`WITH RECURSIVE reachable(id) AS (
          SELECT $3::uuid UNION
          SELECT d.prerequisite_task_id FROM task_dependencies d
          JOIN reachable r ON r.id=d.dependent_task_id WHERE d.project_id=$1
        ) SELECT 1 FROM reachable WHERE id=$2::uuid LIMIT 1`,
        [projectId,input.dependentTaskId,input.prerequisiteTaskId]);
        if(cycle.rowCount)fail(409,'任务依赖存在循环');
        const r=await db.query(`INSERT INTO task_dependencies
          (project_id,dependent_task_id,prerequisite_task_id,created_by)
          VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`,
          [projectId,input.dependentTaskId,input.prerequisiteTaskId,user]);
        if(!r.rowCount)fail(409,'任务依赖已存在');
        return {response:{dependency:r.rows[0]},
          aggregateType:'task_dependencies',aggregateId:input.dependentTaskId,
          aggregateVersion:1};
      },
    });
    return reply.code(201).send(result);
  });
}
