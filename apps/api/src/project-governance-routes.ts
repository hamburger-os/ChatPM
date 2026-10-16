import type { FastifyInstance,FastifyRequest } from 'fastify';
import {z} from 'zod';
import {pool} from '../../../packages/core/src/db.ts';
import {executePmCommand} from '../../../packages/core/src/pm-command.ts';
import {syncFollowup} from '../../../packages/core/src/followup.ts';
import {resolveProjectModel} from '../../../packages/core/src/project-model.ts';

const uuid=z.string().uuid();
const commandKey=z.object({idempotencyKey:uuid});
const invitation=commandKey.extend({
  email:z.string().email().transform(value=>value.toLowerCase()),
});
const roleUpdate=commandKey.extend({
  role:z.enum(['manager','member','observer']),
});
const transferInput=commandKey.extend({
  expectedRevision:z.number().int().positive(),
  targetUserId:uuid,
});
const settingsInput=commandKey.extend({
  expectedRevision:z.number().int().positive(),
  aiEnabled:z.boolean(),
  workStart:z.number().int().min(0).max(23).nullable(),
  workEnd:z.number().int().min(1).max(24).nullable(),
  cooldownHours:z.number().int().min(1).max(168).nullable(),
});
function fail(code:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode:code});
}

/** Human project owner commands, with current tenant and project membership
 * revalidated, audited and serialized in the same transaction as each write.
 */
export function registerProjectGovernanceRoutes(
  app:FastifyInstance,authenticated:(req:FastifyRequest)=>Promise<string>,
):void{
  app.get('/projects/:id/members',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actor=await authenticated(req);
    const access=await pool.query(`SELECT 1 FROM projects p
      JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
      JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$2
      WHERE p.id=$1`,[projectId,actor]);
    if(!access.rowCount)fail(404,'项目不存在或无权限');
    const {rows}=await pool.query(`
      SELECT u.id,u.display_name,u.email,pm.role
      FROM project_members pm JOIN users u ON u.id=pm.user_id
      WHERE pm.project_id=$1 ORDER BY u.display_name
    `,[projectId]);
    return {members:rows};
  });
  app.post('/projects/:id/members',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actor=await authenticated(req);
    const input=invitation.parse(req.body);
    return executePmCommand({
      projectId,actorId:actor,idempotencyKey:input.idempotencyKey,
      kind:'project.member_added.v1',action:'members.manage',payload:input,
      mutate:async db=>{
        const person=(await db.query<{id:string}>(
          'SELECT id FROM users WHERE email=$1',[input.email])).rows[0];
        if(!person)fail(404,'该邮箱尚未注册');
        const tenant=await db.query(`SELECT 1 FROM tenant_members tm
          JOIN projects p ON p.tenant_id=tm.tenant_id
          WHERE p.id=$1 AND tm.user_id=$2 FOR SHARE OF tm`,
          [projectId,person.id]);
        if(!tenant.rowCount)fail(403,'请先由组织管理员将人员加入该组织');
        const added=await db.query<{user_id:string}>(`
          INSERT INTO project_members(project_id,user_id,role)
          VALUES($1,$2,'member') ON CONFLICT DO NOTHING RETURNING user_id
        `,[projectId,person.id]);
        if(!added.rowCount)fail(409,'人员已经属于当前项目');
        return {response:{ok:true},aggregateType:'project_members',
          aggregateId:person.id,aggregateVersion:1,
          auditDetails:{role:'member'}};
      },
    });
  });
  app.patch('/projects/:id/members/:memberId',async req=>{
    const {id,memberId}=req.params as {id:string;memberId:string};
    const projectId=uuid.parse(id),target=uuid.parse(memberId);
    const actor=await authenticated(req);
    const input=roleUpdate.parse(req.body);
    return executePmCommand({
      projectId,actorId:actor,idempotencyKey:input.idempotencyKey,
      kind:'project.member_role_changed.v1',action:'members.manage',
      payload:{target,...input},
      mutate:async db=>{
        const member=(await db.query<{role:string}>(`
          SELECT role FROM project_members
          WHERE project_id=$1 AND user_id=$2 FOR UPDATE
        `,[projectId,target])).rows[0];
        if(!member)fail(404,'项目成员不存在');
        if(member.role==='owner')fail(403,'不能修改项目负责人的角色');
        if(member.role===input.role)fail(409,'成员已处于目标角色');
        if(input.role==='observer'){
          const active=await db.query(`SELECT 1 FROM tasks
            WHERE project_id=$1 AND assignee_id=$2
              AND status NOT IN ('done','cancelled') LIMIT 1`,
            [projectId,target]);
          if(active.rowCount)fail(409,'该人员仍有未完成任务，请先移交任务');
          const deliverables=await db.query(`SELECT 1 FROM project_deliverables
            WHERE project_id=$1 AND assignee_id=$2 AND status<>'accepted' LIMIT 1`,
            [projectId,target]);
          if(deliverables.rowCount)
            fail(409,'该人员仍有待处理交付物，请先移交或完成验收');
          const allocations=await db.query(`SELECT 1 FROM resource_allocations
            WHERE project_id=$1 AND user_id=$2 AND cancelled_at IS NULL
              AND end_date>=CURRENT_DATE LIMIT 1`,[projectId,target]);
          if(allocations.rowCount)
            fail(409,'该人员仍有有效资源投入，请由组织管理员先取消分配');
          const risk=await db.query(`SELECT 1 FROM risks WHERE project_id=$1
            AND owner_id=$2 AND status<>'resolved' LIMIT 1`,[projectId,target]);
          if(risk.rowCount)fail(409,'该人员仍负责未关闭风险，请先移交风险');
          const change=await db.query(`SELECT 1 FROM project_change_requests
            WHERE project_id=$1 AND implementation_owner_id=$2
              AND status='implementing' LIMIT 1`,[projectId,target]);
          if(change.rowCount)
            fail(409,'该人员仍负责实施中的变更，请先重新指派负责人');
        }
        await db.query(`UPDATE project_members SET role=$3
          WHERE project_id=$1 AND user_id=$2`,
          [projectId,target,input.role]);
        return {response:{ok:true},aggregateType:'project_members',
          aggregateId:target,aggregateVersion:1,
          auditDetails:{previousRole:member.role,newRole:input.role}};
      },
    });
  });
  app.delete('/projects/:id/members/:memberId',async req=>{
    const {id,memberId}=req.params as {id:string;memberId:string};
    const projectId=uuid.parse(id),target=uuid.parse(memberId);
    const actor=await authenticated(req);
    const input=commandKey.parse(req.body);
    return executePmCommand({
      projectId,actorId:actor,idempotencyKey:input.idempotencyKey,
      kind:'project.member_removed.v1',action:'members.manage',
      payload:{target,...input},
      mutate:async db=>{
        if(actor===target)fail(400,'不能通过此接口移除项目负责人');
        const member=(await db.query<{role:string}>(`
          SELECT role FROM project_members
          WHERE project_id=$1 AND user_id=$2 FOR UPDATE
        `,[projectId,target])).rows[0];
        if(!member)fail(404,'项目成员不存在');
        if(member.role==='owner')fail(403,'不能移除项目负责人');
        const active=await db.query(`SELECT 1 FROM tasks
          WHERE project_id=$1 AND assignee_id=$2
            AND status NOT IN ('done','cancelled') LIMIT 1`,[projectId,target]);
        if(active.rowCount)fail(409,'该成员仍有未完成任务，请先重新指派或取消任务');
        const deliverables=await db.query(`SELECT 1 FROM project_deliverables
          WHERE project_id=$1 AND assignee_id=$2 AND status<>'accepted' LIMIT 1`,
          [projectId,target]);
        if(deliverables.rowCount)
          fail(409,'该成员仍有待处理交付物，请先移交或完成验收');
        const allocations=await db.query(`SELECT 1 FROM resource_allocations
          WHERE project_id=$1 AND user_id=$2 AND cancelled_at IS NULL
            AND end_date>=CURRENT_DATE LIMIT 1`,[projectId,target]);
        if(allocations.rowCount)
          fail(409,'该人员仍有有效资源投入，请由组织管理员先取消分配');
        const risk=await db.query(`SELECT 1 FROM risks
          WHERE project_id=$1 AND owner_id=$2 AND status<>'resolved' LIMIT 1`,
          [projectId,target]);
        if(risk.rowCount)fail(409,'该成员仍负责未关闭风险，请先移交风险');
        const change=await db.query(`SELECT 1 FROM project_change_requests
          WHERE project_id=$1 AND implementation_owner_id=$2
            AND status='implementing' LIMIT 1`,[projectId,target]);
        if(change.rowCount)
          fail(409,'该成员仍负责实施中的变更，请先重新指派负责人');
        await db.query(`DELETE FROM project_members
          WHERE project_id=$1 AND user_id=$2 AND role<>'owner'`,
          [projectId,target]);
        return {response:{ok:true},aggregateType:'project_members',
          aggregateId:target,aggregateVersion:1,
          auditDetails:{previousRole:member.role}};
      },
    });
  });
  app.post('/projects/:id/ownership-transfer',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actor=await authenticated(req);
    const input=transferInput.parse(req.body);
    return executePmCommand({
      projectId,actorId:actor,idempotencyKey:input.idempotencyKey,
      kind:'project.ownership_transferred.v1',action:'members.manage',
      // After success the previous owner becomes manager, and may only
      // replay his own completed receipt, never issue a new owner command.
      replayAction:'read',payload:input,
      mutate:async db=>{
        if(input.targetUserId===actor)
          fail(400,'项目负责人不能移交给自己');
        const project=(await db.query<{
          owner_id:string;ownership_revision:number;
        }>(`SELECT owner_id,ownership_revision FROM projects
          WHERE id=$1 FOR UPDATE`,[projectId])).rows[0];
        if(!project)fail(404,'项目不存在');
        if(project.owner_id!==actor)fail(403,'只有当前项目负责人可以转让项目');
        if(project.ownership_revision!==input.expectedRevision)
          fail(409,'项目负责人版本已更新，请刷新后再移交');
        const target=(await db.query<{role:string}>(`
          SELECT pm.role FROM project_members pm
          JOIN projects p ON p.id=pm.project_id
          JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
          WHERE pm.project_id=$1 AND pm.user_id=$2
          FOR SHARE OF pm,tm
        `,[projectId,input.targetUserId])).rows[0];
        if(!target)fail(400,'新负责人必须是当前组织与项目成员');
        if(target.role==='owner')fail(409,'该人员已经是项目负责人');
        const previous=await db.query(`
          UPDATE project_members SET role='manager'
          WHERE project_id=$1 AND user_id=$2 AND role='owner' RETURNING user_id
        `,[projectId,actor]);
        if(!previous.rowCount)fail(409,'项目负责人已变化');
        const promoted=await db.query(`
          UPDATE project_members SET role='owner'
          WHERE project_id=$1 AND user_id=$2 RETURNING user_id
        `,[projectId,input.targetUserId]);
        if(!promoted.rowCount)fail(409,'新负责人已经离开项目');
        const updated=await db.query<{ownership_revision:number}>(`
          UPDATE projects SET owner_id=$2,
            ownership_revision=ownership_revision+1
          WHERE id=$1 AND owner_id=$3 AND ownership_revision=$4
          RETURNING ownership_revision
        `,[projectId,input.targetUserId,actor,input.expectedRevision]);
        if(!updated.rowCount)fail(409,'项目负责人已被其他人变更');
        const revision=updated.rows[0].ownership_revision;
        return {response:{ok:true,projectId,previousOwnerId:actor,
          ownerId:input.targetUserId,ownershipRevision:revision},
          aggregateType:'projects',aggregateId:projectId,
          aggregateVersion:revision,
          auditDetails:{previousOwnerId:actor,ownerId:input.targetUserId,
            previousTargetRole:target.role}};
      },
    });
  });
  app.patch('/projects/:id/settings',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actor=await authenticated(req);
    const input=settingsInput.parse(req.body);
    const noReminder=input.workStart===null&&input.workEnd===null&&
      input.cooldownHours===null;
    if(!noReminder&&(input.workStart===null||input.workEnd===null||
      input.cooldownHours===null||input.workStart>=input.workEnd))
      fail(400,'提醒策略必须完整配置');
    return executePmCommand({
      projectId,actorId:actor,idempotencyKey:input.idempotencyKey,
      kind:'project.settings_changed.v1',action:'settings.manage',payload:input,
      mutate:async db=>{
        const before=(await db.query<{
          ai_enabled:boolean;work_start:number|null;work_end:number|null;
          cooldown_hours:number|null;settings_revision:number;
        }>(`SELECT ai_enabled,work_start,work_end,cooldown_hours,
          settings_revision FROM projects WHERE id=$1 FOR UPDATE`,
          [projectId])).rows[0];
        if(!before)fail(404,'项目不存在');
        if(before.settings_revision!==input.expectedRevision)
          fail(409,'项目设置版本已变化，请刷新后重试');
        // Never emit a "settings changed" event or replan follow-ups for
        // a brand-new command that did not change any persisted setting.
        if(before.ai_enabled===input.aiEnabled&&
           before.work_start===input.workStart&&
           before.work_end===input.workEnd&&
           before.cooldown_hours===input.cooldownHours)
          fail(409,'项目设置未发生变化');
        if(input.aiEnabled){
          try{await resolveProjectModel(projectId,db);}
          catch{fail(400,'服务器尚未正确配置 AI 模型');}
        }
        const updated=await db.query<{settings_revision:number}>(`
          UPDATE projects SET ai_enabled=$2,work_start=$3,work_end=$4,
            cooldown_hours=$5,settings_revision=settings_revision+1
          WHERE id=$1 AND settings_revision=$6 RETURNING settings_revision
        `,[projectId,input.aiEnabled,input.workStart,input.workEnd,
          input.cooldownHours,input.expectedRevision]);
        if(!updated.rowCount)fail(409,'项目设置版本已变化');
        const tasks=await db.query<{id:string}>(`
          SELECT id FROM tasks WHERE project_id=$1`,[projectId]);
        for(const task of tasks.rows)await syncFollowup(db,projectId,task.id);
        return {response:{ok:true,settingsRevision:updated.rows[0].settings_revision},
          aggregateType:'projects',aggregateId:projectId,
          aggregateVersion:updated.rows[0].settings_revision,
          auditDetails:{previousSettings:{
            aiEnabled:before.ai_enabled,workStart:before.work_start,
            workEnd:before.work_end,cooldownHours:before.cooldown_hours},
            nextSettings:{aiEnabled:input.aiEnabled,workStart:input.workStart,
              workEnd:input.workEnd,cooldownHours:input.cooldownHours},
            hasReminderPolicy:!noReminder}};
      },
    });
  });
}
