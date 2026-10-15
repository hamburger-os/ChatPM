import {transaction} from '../db.ts';

type Department={id:string;name:string;parent_id:string|null};
type Program={id:string;name:string;description:string;portfolio_id:string|null};
type Portfolio={id:string;name:string;description:string};
type ProjectClassification={
  id:string;name:string;department_id:string|null;
  program_id:string|null;portfolio_id:string|null;
  classification_revision:number;participating_department_ids:string[];
};
export type TenantStructure={
  departments:Department[];programs:Program[];portfolios:Portfolio[];
  projects:ProjectClassification[];
};

function denied():never{
  throw Object.assign(new Error('没有该组织的访问权限'),{statusCode:403});
}

/**
 * Explicit tenant read model. Current org membership is checked in the SAME
 * repeatable-read transaction as all resulting tables. A SHARE lock prevents
 * tenant removal/demotion from racing with the response. Non-admin project
 * grants are locked as well: a user must still be an explicit project member.
 * Department/program/portfolio metadata may be read by all tenant members,
 * but classification of other members' projects must never leak.
 */
export async function getTenantStructure(tenantId:string,userId:string):
  Promise<TenantStructure>{
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const membership=await db.query<{role:'admin'|'member'}>(`
      SELECT role FROM tenant_members
      WHERE tenant_id=$1 AND user_id=$2 FOR SHARE`,[tenantId,userId]);
    const role=membership.rows[0]?.role;
    if(!role)denied();

    const departments=await db.query<Department>(
      'SELECT id,name,parent_id FROM departments WHERE tenant_id=$1 ORDER BY name',
      [tenantId]);
    const portfolios=await db.query<Portfolio>(
      'SELECT id,name,description FROM portfolios WHERE tenant_id=$1 ORDER BY name',
      [tenantId]);
    const programs=await db.query<Program>(
      'SELECT id,name,description,portfolio_id FROM programs WHERE tenant_id=$1 ORDER BY name',
      [tenantId]);
    const select=`SELECT p.id,p.name,p.department_id,p.program_id,
      p.portfolio_id,p.classification_revision,
      (SELECT COALESCE(array_agg(pd.department_id ORDER BY pd.department_id),
          ARRAY[]::uuid[])
       FROM project_departments pd WHERE pd.project_id=p.id
         AND pd.tenant_id=p.tenant_id) AS participating_department_ids
      FROM projects p`;
    const projects=role==='admin'
      ?await db.query<ProjectClassification>(
        select+' WHERE p.tenant_id=$1 ORDER BY p.name,p.id',[tenantId])
      :await db.query<ProjectClassification>(
        select+` JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
          WHERE p.tenant_id=$1 ORDER BY p.name,p.id FOR SHARE OF pm`,
        [tenantId,userId]);
    return {departments:departments.rows,programs:programs.rows,
      portfolios:portfolios.rows,projects:projects.rows};
  });
}
