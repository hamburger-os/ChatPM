import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../src/db.ts';
import { ConfiguredLLMProvider, readProjectAiAuthorization, assertCurrentAiGrant } from '../src/ai-provider.ts';

const suffix=randomUUID();
try {
  const user=(await pool.query(
    "INSERT INTO users(email,display_name,password_hash) VALUES($1,'AI Grant Test','unused') RETURNING id",
    ['auth-version-'+suffix+'@example.com'])).rows[0];
  const tenant=(await pool.query("INSERT INTO tenants(name) VALUES('Grant tests') RETURNING id")).rows[0];
  const project=(await pool.query(
    "INSERT INTO projects(tenant_id,name,owner_id) VALUES($1,'AI grant test',$2) RETURNING id",
    [tenant.id,user.id])).rows[0];

  assert.deepEqual(await readProjectAiAuthorization(project.id),{enabled:false,version:1});
  await assert.rejects(new ConfiguredLLMProvider(project.id).analyzeWork('Private','Do not send'),
    /AI_AUTHORIZATION_REVOKED/);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM ai_model_invocations WHERE project_id=$1",
    [project.id])).rows[0].count,0);

  await pool.query('UPDATE projects SET ai_enabled=TRUE WHERE id=$1',[project.id]);
  assert.deepEqual(await readProjectAiAuthorization(project.id),{enabled:true,version:2});
  await transaction(async db=>{
    await assertCurrentAiGrant(db,project.id,2);
    await assert.rejects(assertCurrentAiGrant(db,project.id,1),
      /AI_AUTHORIZATION_CHANGED/);
  });
  await pool.query('UPDATE projects SET ai_enabled=TRUE WHERE id=$1',[project.id]);
  assert.deepEqual(await readProjectAiAuthorization(project.id),{enabled:true,version:2});
  await pool.query('UPDATE projects SET ai_enabled=FALSE WHERE id=$1',[project.id]);
  assert.deepEqual(await readProjectAiAuthorization(project.id),{enabled:false,version:3});
  await transaction(async db=>{
    await assert.rejects(assertCurrentAiGrant(db,project.id,2),
      /AI_AUTHORIZATION_REVOKED/);
  });
  await assert.rejects(new ConfiguredLLMProvider(project.id).respond('Private','Do not send'),
    /AI_AUTHORIZATION_REVOKED/);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM ai_daily_usage WHERE project_id=$1",
    [project.id])).rows[0].count,0);
  console.log('AI authorization version integration passed');
} finally { await pool.end(); }
