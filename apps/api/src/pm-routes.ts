import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool, type DbClient } from '../../../packages/core/src/db.ts';
import { executePmCommand, type PmMutation } from '../../../packages/core/src/pm-command.ts';
import { assertProject, type ProjectAction, type ProjectRole } from '../../../packages/core/src/permissions.ts';
import { lockTaskDependencyGraph } from '../../../packages/core/src/delivery/dependency-policy.ts';

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
        // Responsibility is checked at assignment time, not enforced as a
        // historical FK to mutable membership. Otherwise a person could never
        // leave a project after completing an accepted deliverable.
        const assignee=kind==='deliverables'?input.assigneeId:
          kind==='issues'?input.ownerId:null;
        if(assignee){
          const active=await db.query(`SELECT 1 FROM project_members pm
            JOIN projects p ON p.id=pm.project_id
            JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
            WHERE pm.project_id=$1 AND pm.user_id=$2 FOR SHARE OF pm,tm`,
            [projectId,assignee]);
          if(!active.rowCount)fail(400,'负责人必须是当前项目和组织成员');
        }
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

  // Issue is an occurred problem, not a prospective risk. State changes
  // require a human explanation and retain append-only, project-scoped history.
  const issueTransitionSchema=versioned.extend({
    decision:z.enum(['resolve','reopen']),
    note:z.string().trim().min(1).max(2000),
  });
  app.post('/projects/:projectId/pm/issues/:itemId/transition',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=issueTransitionSchema.parse(req.body);
    return executePmCommand({
      projectId,actorId:user,idempotencyKey:input.idempotencyKey,
      action:'pm.plan',kind:'pm.issue.transitioned.v1',payload:{id,...input},
      mutate:async db=>{
        const r=await db.query<{status:'open'|'resolved';version:number}>(`
          SELECT status,version FROM project_issues
          WHERE project_id=$1 AND id=$2 FOR UPDATE
        `,[projectId,id]);
        const issue=r.rows[0];
        if(!issue)fail(404,'问题不存在');
        if(issue.version!==input.expectedVersion)fail(409,'问题版本冲突');
        const target=input.decision==='resolve'?'resolved':'open';
        if(issue.status===target)fail(409,'问题已经处于目标状态');
        const updated=await db.query(`
          UPDATE project_issues SET status=$3,version=version+1
          WHERE project_id=$1 AND id=$2 RETURNING *
        `,[projectId,id,target]);
        const item=updated.rows[0] as Record<string,unknown>;
        await db.query(`
          INSERT INTO project_issue_transitions(
            project_id,issue_id,from_status,to_status,issue_version,note,actor_id)
          VALUES($1,$2,$3,$4,$5,$6,$7)
        `,[projectId,id,issue.status,target,item.version,input.note,user]);
        return {response:{item},aggregateType:'issues',aggregateId:id,
          aggregateVersion:Number(item.version)} satisfies Mutation;
      },
    });
  });

  app.get('/projects/:projectId/pm/issues/:itemId/history',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const paging=z.object({beforeVersion:z.coerce.number().int().positive().optional()})
      .parse(req.query);
    const scoped=await pool.query(`
      SELECT i.id FROM project_issues i
      JOIN project_members pm ON pm.project_id=i.project_id AND pm.user_id=$3
      JOIN projects p ON p.id=i.project_id
      JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$3
      WHERE i.project_id=$1 AND i.id=$2
    `,[projectId,id,user]);
    if(!scoped.rowCount)fail(404,'问题不存在或无权限');
    // 51 rows make truncation explicit instead of silently hiding history.
    const {rows}=await pool.query<{
      id:string;from_status:string;to_status:string;issue_version:number;
      note:string;actor_id:string;occurred_at:Date;
    }>(`SELECT id,from_status,to_status,issue_version,note,actor_id,occurred_at
      FROM project_issue_transitions
      WHERE project_id=$1 AND issue_id=$2 AND issue_version<COALESCE($3::int,2147483647)
      ORDER BY issue_version DESC LIMIT 51`,
      [projectId,id,paging.beforeVersion??null]);
    return {history:rows.slice(0,50),
      nextBeforeVersion:rows.length>50?rows[49].issue_version:null};
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

  // An approved ChangeRequest is not an implemented baseline change.
  // Only a human execution owner may author post-start message evidence,
  // verified by a different active project owner/manager.
  const implementationSchema=z.discriminatedUnion('decision',[
    versioned.extend({decision:z.literal('start'),ownerId:uuid,
      note:z.string().trim().min(1).max(2000)}),
    versioned.extend({decision:z.literal('complete'),evidenceMessageId:uuid,
      note:z.string().trim().min(1).max(2000)}),
  ]);
  app.post('/projects/:projectId/pm/changes/:itemId/implementation',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=implementationSchema.parse(req.body);
    return executePmCommand({
      projectId,actorId:user,idempotencyKey:input.idempotencyKey,
      action:input.decision==='start'?'pm.plan':'pm.accept',
      kind:input.decision==='start'?'pm.change.implementation_started.v1':
        'pm.change.implemented.v1',
      payload:{id,...input},
      mutate:async db=>{
        const before=(await db.query<{
          version:number;status:string;implementation_owner_id:string|null;
          implementation_started_at:Date|null;
        }>(`SELECT version,status,implementation_owner_id,implementation_started_at
          FROM project_change_requests
          WHERE project_id=$1 AND id=$2 FOR UPDATE`,[projectId,id])).rows[0];
        if(!before)fail(404,'变更申请不存在');
        if(before.version!==input.expectedVersion)fail(409,'变更申请版本冲突');
        let changed:Record<string,unknown>;
        let evidenceId:string|null=null;
        if(input.decision==='start'){
          if(before.status!=='approved')fail(409,'只有已批准变更可以启动实施');
          const active=await db.query(`
            SELECT 1 FROM project_members pm
            JOIN projects p ON p.id=pm.project_id
            JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
            WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.role<>'observer'
            FOR SHARE OF pm,tm
          `,[projectId,input.ownerId]);
          if(!active.rowCount)fail(400,'实施责任人必须是当前项目和组织的有效成员');
          changed=(await db.query(`
            UPDATE project_change_requests SET status='implementing',
              implementation_owner_id=$3,implementation_started_at=NOW(),
              version=version+1
            WHERE project_id=$1 AND id=$2 RETURNING *
          `,[projectId,id,input.ownerId])).rows[0];
        }else{
          if(before.status!=='implementing')fail(409,'只有实施中的变更可以确认完成');
          if(!before.implementation_owner_id||!before.implementation_started_at)
            fail(409,'变更缺少实施责任人或开始时间');
          if(before.implementation_owner_id===user)
            fail(403,'实施责任人不能自我核验变更完成');
          const evidence=await db.query(`
            SELECT 1 FROM messages
            WHERE project_id=$1 AND id=$2 AND kind='user'
              AND author_id=$3 AND created_at>=$4
            FOR SHARE
          `,[projectId,input.evidenceMessageId,before.implementation_owner_id,
            before.implementation_started_at]);
          if(!evidence.rowCount)fail(409,'实施证据必须是负责人开始执行后发布的项目原始消息');
          evidenceId=input.evidenceMessageId;
          changed=(await db.query(`
            UPDATE project_change_requests SET status='implemented',
              implementation_evidence_message_id=$3,
              implemented_by=$4,implemented_at=NOW(),version=version+1
            WHERE project_id=$1 AND id=$2 RETURNING *
          `,[projectId,id,evidenceId,user])).rows[0];
        }
        await db.query(`
          INSERT INTO project_change_implementation_history(
            project_id,change_id,change_version,action,from_status,
            to_status,note,actor_id,evidence_message_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,[projectId,id,changed.version,input.decision,before.status,
          changed.status,input.note,user,evidenceId]);
        return {response:{item:changed},aggregateType:'changes',
          aggregateId:id,aggregateVersion:Number(changed.version),
          auditDetails:{decision:input.decision,evidenceMessageId:evidenceId}};
      },
    });
  });

  app.get('/projects/:projectId/pm/changes/:itemId/implementation/history',
    async req=>{
      const projectId=context(req),user=await authenticated(req);
      const id=uuid.parse((req.params as {itemId:string}).itemId);
      const page=z.object({beforeVersion:z.coerce.number().int().positive().optional()})
        .parse(req.query);
      const scoped=await pool.query(`
        SELECT 1 FROM project_change_requests c
        JOIN projects p ON p.id=c.project_id
        JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$3
        JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$3
        WHERE c.project_id=$1 AND c.id=$2
      `,[projectId,id,user]);
      if(!scoped.rowCount)fail(404,'变更申请不存在或无权限');
      const {rows}=await pool.query<{
        id:string;change_version:number;from_status:string;to_status:string;
        action:string;note:string;actor_id:string;
        evidence_message_id:string|null;occurred_at:Date;
      }>(`SELECT id,change_version,from_status,to_status,action,note,
          actor_id,evidence_message_id,occurred_at
        FROM project_change_implementation_history
        WHERE project_id=$1 AND change_id=$2
          AND change_version<COALESCE($3::int,2147483647)
        ORDER BY change_version DESC LIMIT 51
      `,[projectId,id,page.beforeVersion??null]);
      return {history:rows.slice(0,50),
        nextBeforeVersion:rows.length>50?rows[49].change_version:null};
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
        // Serialize both dependency inserts and dependent task completion.
        await lockTaskDependencyGraph(db,projectId);
        const known=await db.query<{id:string;status:string}>(`SELECT id,status FROM tasks
          WHERE project_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`,
          [projectId,[input.dependentTaskId,input.prerequisiteTaskId]]);
        if(known.rows.length!==2)fail(404,'任务必须都属于同一项目');
        const byId=new Map(known.rows.map(t=>[t.id,t.status]));
        if(byId.get(input.dependentTaskId)==='done'&&
          byId.get(input.prerequisiteTaskId)!=='done')
          fail(409,'不能为已完成任务新增未完成的前置任务');
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
