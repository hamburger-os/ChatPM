import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../src/db.ts';
import { insertMessage } from '../src/messages.ts';
import { processClarification } from '../src/clarification.ts';
import { projectAnalysisContext } from '../src/project-context.ts';
import { DailyAIBudgetExceeded } from '../src/ai-provider.ts';
import { encryptModelKey } from '../src/project-model.ts';

const id=randomUUID();
const previousFetch=globalThis.fetch;
const previousLimit=process.env.AI_DAILY_REQUEST_LIMIT;
let providerCalls=0;
try{
  process.env.AI_DAILY_REQUEST_LIMIT='4';
  globalThis.fetch=async(_input,init)=>{
    providerCalls++;
    assert.equal(String(_input),'https://api.openai.com/v1/responses');
    const body=JSON.parse(String(init?.body));
    assert.equal(body.text.format.type,'json_schema');
    assert.ok(body.input[0].content.includes('不可信'));
    const noDetails=body.input[1].content.includes('仅说九月底');
    return new Response(JSON.stringify({output:[{content:[{
      type:'output_text',text:JSON.stringify(noDetails
        ? {assignee_hint:null,due_at:null,confidence:0.3}
        : {assignee_hint:'测试负责人',due_at:'2026-12-10T10:00:00+08:00',confidence:0.9}),
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
  await pool.query(`INSERT INTO ai_model_configs
    (name,model_id,base_url,api_style,api_key_ciphertext,enabled,is_default)
    VALUES($1,'mock-project-model','https://api.openai.com/v1','responses',$2,TRUE,TRUE)`,
    ['integration-'+id,encryptModelKey('fake-key-for-mocked-requests')]);
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
  // A single recently asked clarification can be answered naturally without copying its UUID.
  await transaction(db=>insertMessage(db,{
    projectId:project.id,authorId:null,kind:'ai',
    content:'关于【候选:'+proposal.id+'】，请补充负责人及截止日期。',
    nonce:'test-ai-question:'+randomUUID(),
  }));
  const plain=await transaction(db=>insertMessage(db,{
    projectId:project.id,authorId:user.id,kind:'user',
    content:'由测试负责人负责，2026年12月10日完成。',nonce:randomUUID(),
  }));
  assert.ok(plain);
  assert.equal(await processClarification({
    id:plain.id,projectId:project.id,content:plain.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,3);
  const context=await projectAnalysisContext(project.id,plain.id,1400);
  assert.ok(context.length<=1400,'Configured context budget must not be exceeded');
  assert.ok(context.includes(plain.content),'The newest user message must remain in context');
  // Unparseable dates are acknowledged but never guessed; replays cannot double-spend.
  const vague=await reply('仅说九月底');
  assert.ok(vague);
  assert.equal(await processClarification({
    id:vague.id,projectId:project.id,content:vague.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,4);
  await processClarification({
    id:vague.id,projectId:project.id,content:vague.content,projectName:'AI mocked project',
  });
  assert.equal(providerCalls,4);
  const unclear=await pool.query('SELECT 1 FROM clarification_responses WHERE message_id=$1',[vague.id]);
  assert.equal(unclear.rowCount,1,'Ambiguous evidence must be idempotently retained');
  const followup=await pool.query(
    "SELECT 1 FROM messages WHERE project_id=$1 AND client_nonce=$2",
    [project.id,'clarification-needs-detail:'+vague.id]);
  assert.equal(followup.rowCount,1);
  const answer3=await reply('补充备注');
  assert.ok(answer3);
  await assert.rejects(
    processClarification({
      id:answer3.id,projectId:project.id,content:answer3.content,projectName:'AI mocked project',
    }),
    DailyAIBudgetExceeded,
  );
  assert.equal(providerCalls,4);
  const unknown=await transaction(db=>insertMessage(db,{
    projectId:project.id,authorId:user.id,kind:'user',
    content:'【候选:'+randomUUID()+'】不属于本项目',nonce:randomUUID(),
  }));
  assert.ok(unknown);
  assert.equal(await processClarification({
    id:unknown.id,projectId:project.id,content:unknown.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,4,'Unrelated proposals must not trigger model calls');
  console.log('AI integration passed: source-bound multi-turn evidence, replay, budget and no automatic task updates');
}finally{
  globalThis.fetch=previousFetch;
  if(previousLimit===undefined)delete process.env.AI_DAILY_REQUEST_LIMIT;
  else process.env.AI_DAILY_REQUEST_LIMIT=previousLimit;
  await pool.end();
}
