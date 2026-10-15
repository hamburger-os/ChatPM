import {organizationCommand} from '../organization-commands.ts';

export type ClassificationInput={
  idempotencyKey:string;
  expectedRevision:number;
  departmentId:string|null;
  programId:string|null;
  portfolioId:string|null;
  participatingDepartmentIds:string[];
};
function deny(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}
type CurrentClassification={
  classification_revision:number;
  department_id:string|null;
  program_id:string|null;
  portfolio_id:string|null;
};

/**
 * Sole owner of Project classification mutations. The organizational command
 * runtime serializes tenant governance and verifies CURRENT admin membership;
 * this handler adds Project revision fencing, main/participant department
 * validation at the API boundary, cross-tenant FK enforcement and one audit.
 *
 * Both classification columns and the entire participating-department set
 * commit atomically. No HTTP route may independently mutate these tables.
 */
export async function changeProjectClassification(
  tenantId:string,actorId:string,projectId:string,input:ClassificationInput,
){
  // The core command owns business invariants even if a future non-HTTP
  // caller bypasses Zod's input-shape validation.
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)
    deny(400,'项目归属版本无效');
  if(input.programId!==null&&input.portfolioId!==null)
    deny(400,'项目只能通过项目集或直接归属于组合');
  if(input.participatingDepartmentIds.length>50||
     new Set(input.participatingDepartmentIds).size!==input.participatingDepartmentIds.length)
    deny(400,'参与部门重复或超出上限');
  if(input.departmentId!==null&&
     input.participatingDepartmentIds.includes(input.departmentId))
    deny(400,'主责部门不能同时列为参与部门');
  const value=input;
  return organizationCommand(tenantId,actorId,'project.classification_changed',
    {idempotencyKey:input.idempotencyKey,payload:input},async db=>{
    const before=(await db.query<CurrentClassification>(`
      SELECT classification_revision,department_id,program_id,portfolio_id
      FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE
    `,[tenantId,projectId])).rows[0];
    if(!before)deny(404,'项目不存在');
    if(before.classification_revision!==value.expectedRevision)
      deny(409,'项目归属已被修改，请刷新后重新确认');
    const previous=(await db.query<{department_id:string}>(`
      SELECT department_id FROM project_departments
      WHERE tenant_id=$1 AND project_id=$2 ORDER BY department_id FOR UPDATE
    `,[tenantId,projectId])).rows.map(row=>row.department_id);
    const participants=[...value.participatingDepartmentIds].sort();
    const unchanged=previous.length===participants.length&&
      previous.every((id,index)=>id===participants[index]);
    if(before.department_id===value.departmentId&&
       before.program_id===value.programId&&
       before.portfolio_id===value.portfolioId&&unchanged)
      deny(409,'项目已采用该归属，不需要重复修改');
    const updated=(await db.query<{
      id:string;department_id:string|null;program_id:string|null;
      portfolio_id:string|null;classification_revision:number;
    }>(`
      UPDATE projects SET department_id=$3,program_id=$4,
        portfolio_id=$5,classification_revision=classification_revision+1
      WHERE tenant_id=$1 AND id=$2 AND classification_revision=$6
      RETURNING id,department_id,program_id,portfolio_id,classification_revision
    `,[tenantId,projectId,value.departmentId,value.programId,
      value.portfolioId,value.expectedRevision])).rows[0];
    if(!updated)deny(409,'项目归属版本冲突');

    await db.query('DELETE FROM project_departments WHERE tenant_id=$1 AND project_id=$2',
      [tenantId,projectId]);
    if(participants.length)await db.query(`
      INSERT INTO project_departments(tenant_id,project_id,department_id)
      SELECT $1,$2,unnest($3::uuid[])
    `,[tenantId,projectId,participants]);

    return {value:{...updated,participating_department_ids:participants},
      targetId:projectId,
      metadata:{
        previousRevision:before.classification_revision,
        classificationRevision:updated.classification_revision,
        departmentId:value.departmentId,programId:value.programId,
        portfolioId:value.portfolioId,
        participatingDepartmentIds:participants,
        previousParticipatingDepartmentIds:previous,
      }};
  });
}
