import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../src/db.ts';
import { insertMessage } from '../src/messages.ts';
import { processClarification } from '../src/clarification.ts';
import { DailyAIBudgetExceeded } from '../src/ai-provider.ts';

const id=randomUUID();
const previousFetch=globalThis.fetch;
const previousKey=process.env.OPENAI_API_KEY;
const previousLimit=process.env.AI_DAILY_REQUEST_LIMIT;
let providerCalls=0;
try{
  process.env.OPENAI_API_KEY='fake-key-for-mocked-requests';
  process.env.AI_DAILY_REQUEST_LIMIT='2';
  globalThis.fetch=async(_input,init)=>{
    providerCalls++;
    const body=JSON.parse(String(init?.body));
    assert.equal(body.text.format.type,'json_schema');
    assert.ok(body.input[0].content.includes('不可信'));
    return new Response(JSON.stringify({output:[{content:[{
      type:'output_text',text:JSON.stringify({
        assignee_hint:'测试负责人',due_at:'2026-12-10T10:00:00+08:00',confidence:0.9,
      }),
    }]}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const user=(await pool.query(
    "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Mock','unused') RETURNING id",
    ['mock-'+id+'@example.com'])).rows[0];
  const tenant=(await pool.query(
    "INSERT INTO tenants(name) VALUES('AI mock tenant') RETURNING id")).rows[0];
  const project=(await pool.query(
    "INSERT INTO projects(tenant_id,name,owner_id) VALUES($1,'AI mocked project',$2) RETURNING id",
    [tenant.id,user.id])).rows[0];
  const source=await transaction(db=>insertMessage(db,{
    projectId:project.id,authorId:user.id,kind:'user',
    content:'需要发布接口，负责人和时间还没有确定',nonce:randomUUID(),
  }));
  assert.ok(source);
  const proposal=(await pool.query(
    "INSERT INTO proposed_changes(project_id,source_message_id,kind,title) VALUES($1,$2,'task','接口发布') RETURNING id",
    [project.id,source.id])).rows[0];
  await pool.query('INSERT INTO clarification_threads(proposal_id,project_id) VALUES($1,$2)',
    [proposal.id,project.id]);
  async function reply(suffix:string){
    return transaction(db=>insertMessage(db,{
      projectId:project.id,authorId:user.id,kind:'user',
      content:'【候选:'+proposal.id+'】 '+suffix,nonce:randomUUID(),
    }));
  }
  const answer1=await reply('负责人：测试负责人');
  assert.ok(answer1);
  assert.equal(await processClarification({
    id:answer1.id,projectId:project.id,content:answer1.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,1);
  // Replaying a source event must not charge AI quota or emit a second response.
  await processClarification({
    id:answer1.id,projectId:project.id,content:answer1.content,projectName:'AI mocked project',
  });
  assert.equal(providerCalls,1);
  const answer2=await reply('截止时间补充 2026-12-10T10:00:00+08:00');
  assert.ok(answer2);
  await processClarification({
    id:answer2.id,projectId:project.id,content:answer2.content,projectName:'AI mocked project',
  });
  assert.equal(providerCalls,2);
  const saved=await pool.query(
    'SELECT status,version,response_message_id,assignee_hint,due_at FROM clarification_threads WHERE proposal_id=$1',
    [proposal.id]);
  assert.equal(saved.rows[0].status,'answered');
  assert.equal(saved.rows[0].version,3);
  assert.equal(saved.rows[0].response_message_id,answer2.id);
  assert.equal(saved.rows[0].assignee_hint,'测试负责人');
  assert.ok(saved.rows[0].due_at);
  assert.equal((await pool.query(
    'SELECT COUNT(*)::int AS n FROM clarification_responses WHERE proposal_id=$1',
    [proposal.id])).rows[0].n,2);
  assert.equal((await pool.query(
    'SELECT COUNT(*)::int AS n FROM tasks WHERE source_proposal_id=$1',
    [proposal.id])).rows[0].n,0,'AI clarification may not create official tasks');
  const answer3=await reply('补充备注');
  assert.ok(answer3);
  await assert.rejects(
    processClarification({
      id:answer3.id,projectId:project.id,content:answer3.content,projectName:'AI mocked project',
    }),
    DailyAIBudgetExceeded,
  );
  assert.equal(providerCalls,2);
  const unknown=await transaction(db=>insertMessage(db,{
    projectId:project.id,authorId:user.id,kind:'user',
    content:'【候选:'+randomUUID()+'】不属于本项目',nonce:randomUUID(),
  }));
  assert.ok(unknown);
  assert.equal(await processClarification({
    id:unknown.id,projectId:project.id,content:unknown.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,2,'Unrelated proposals must not trigger model calls');
  console.log('AI integration passed: source-bound multi-turn evidence, replay, budget and no automatic task updates');
}finally{
  globalThis.fetch=previousFetch;
  if(previousKey===undefined)delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY=previousKey;
  if(previousLimit===undefined)delete process.env.AI_DAILY_REQUEST_LIMIT;
  else process.env.AI_DAILY_REQUEST_LIMIT=previousLimit;
  await pool.end();
}
