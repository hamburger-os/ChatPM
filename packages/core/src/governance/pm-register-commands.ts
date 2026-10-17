import {z} from 'zod';
import {executePmCommand,type PmMutation} from '../pm-command.ts';
import {assertProject,type ProjectAction} from '../permissions.ts';
import {lockTaskDependencyGraph} from '../delivery/dependency-policy.ts';
import type {DbClient} from '../db.ts';

const uuid=z.string().uuid();
const title=z.string().trim().min(1).max(250);
const longText=z.string().trim().min(1).max(5000);
const date=z.string().date();
const key={idempotencyKey:uuid};
export const pmCreateDefinitions={
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

export const pmEntryKind=z.enum(['goals','milestones','deliverables','issues','decisions','changes']);
export type PmEntryKind=z.infer<typeof pmEntryKind>;
type Mutation=PmMutation<{item:Record<string,unknown>}>;
type Versioned={idempotencyKey:string;expectedVersion:number};
type ReassignInput=Versioned & {assigneeId:string;note:string};
type ImplementationInput=
  | (Versioned & {decision:'start';ownerId:string;note:string})
  | (Versioned & {decision:'reassign';ownerId:string;note:string})
  | (Versioned & {decision:'complete';evidenceMessageId:string;note:string});
type DependencyInput={idempotencyKey:string;dependentTaskId:string;prerequisiteTaskId:string};
function fail(code:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode:code});
}

export function createPmEntry(projectId:string,user:string,kind:PmEntryKind,input:Record<string,unknown>){
  const spec=pmCreateDefinitions[kind];
  const fields=spec.fields as ReadonlyArray<readonly [string,string]>;
  const columns=['project_id',spec.actorColumn,...fields.map(x=>x[0])];
  const params=[projectId,user,...fields.map(x=>input[x[1]])];
  return executePmCommand({
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
          WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.role<>'observer' FOR SHARE OF pm,tm`,
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
}

export function reassignPmDeliverable(projectId:string,id:string,actor:string,input:ReassignInput){
  return executePmCommand({
    projectId,actorId:actor,action:'pm.plan',
    kind:'pm.deliverable.reassigned.v1',
    idempotencyKey:input.idempotencyKey,payload:{id,...input},
    mutate:async db=>{
      const before=(await db.query<{
        version:number;status:string;assignee_id:string;
      }>(`SELECT version,status,assignee_id FROM project_deliverables
        WHERE project_id=$1 AND id=$2 FOR UPDATE`,[projectId,id])).rows[0];
      if(!before)fail(404,'交付物不存在');
      if(before.version!==input.expectedVersion)fail(409,'交付物版本冲突');
      if(before.status==='accepted')fail(409,'已验收交付物不能重新指派');
      if(before.assignee_id===input.assigneeId)fail(409,'交付物责任人未发生变化');
      const eligible=await db.query(`SELECT 1 FROM project_members pm
        JOIN projects p ON p.id=pm.project_id
        JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
        WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.role<>'observer'
        FOR SHARE OF pm,tm`,[projectId,input.assigneeId]);
      if(!eligible.rowCount)fail(400,'新交付物负责人必须是当前项目有效成员');
      // Any prior submission belongs to the former assignee. The successor
      // must submit again and receive independent acceptance.
      const updated=(await db.query(`UPDATE project_deliverables SET
        assignee_id=$3,status='planned',submitted_by=NULL,submitted_at=NULL,
        reviewed_by=NULL,reviewed_at=NULL,version=version+1
        WHERE project_id=$1 AND id=$2 RETURNING *`,
        [projectId,id,input.assigneeId])).rows[0];
      return {response:{item:updated},aggregateType:'deliverables',
        aggregateId:id,aggregateVersion:updated.version,
        auditDetails:{previousAssigneeId:before.assignee_id,
          newAssigneeId:input.assigneeId,previousStatus:before.status,
          note:input.note}};
    },
  });
}

export function submitPmDeliverable(projectId:string,id:string,user:string,input:Versioned){
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
}

export function reviewPmDeliverable(projectId:string,id:string,user:string,input:Versioned & {decision:'accept'|'return'}){
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
}

export function transitionPmIssue(projectId:string,id:string,user:string,input:Versioned & {decision:'resolve'|'reopen';note:string}){
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
}

export function decidePmChange(projectId:string,id:string,user:string,input:Versioned & {decision:'approve'|'reject'}){
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
}

export function updatePmChangeImplementation(projectId:string,id:string,user:string,input:ImplementationInput){
  return executePmCommand({
    projectId,actorId:user,idempotencyKey:input.idempotencyKey,
    action:input.decision==='complete'?'pm.accept':'pm.plan',
    kind:input.decision==='start'?'pm.change.implementation_started.v1':
      input.decision==='reassign'?'pm.change.implementation_reassigned.v1':
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
      if(input.decision==='start'||input.decision==='reassign'){
        if(input.decision==='start'&&before.status!=='approved')
          fail(409,'只有已批准变更可以启动实施');
        if(input.decision==='reassign'){
          if(before.status!=='implementing')
            fail(409,'只有实施中的变更可以重新分配责任人');
          if(before.implementation_owner_id===input.ownerId)
            fail(409,'实施责任人尚未发生变化');
        }
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
        const stillActive=await db.query(`
          SELECT 1 FROM project_members pm
          JOIN projects p ON p.id=pm.project_id
          JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
          WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.role<>'observer'
          FOR SHARE OF pm,tm
        `,[projectId,before.implementation_owner_id]);
        if(!stillActive.rowCount)
          fail(409,'实施责任人已失去项目资格，请重新指派');
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
}

export function createPmTaskDependency(projectId:string,user:string,input:DependencyInput){
  return executePmCommand({
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
}
