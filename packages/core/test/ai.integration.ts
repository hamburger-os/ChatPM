import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../src/db.ts';
import { insertMessage } from '../src/messages.ts';
import { processClarification } from '../src/clarification.ts';
import {claimEvents,type EventRow} from '../src/outbox.ts';
import { projectAnalysisContext } from '../src/project-context.ts';
import { DailyAIBudgetExceeded } from '../src/ai-provider.ts';
import { encryptModelKey } from '../src/project-model.ts';

const id=randomUUID();
const previousLimit=process.env.AI_DAILY_REQUEST_LIMIT;
let providerCalls=0;
// Exercise the REAL guarded model HTTP transport, not a global fetch monkeypatch.
const fakeProvider=createServer((request,response)=>{
  assert.equal(request.method,'POST');
  assert.equal(request.url,'/v1/responses');
  assert.equal(request.headers.authorization,'Bearer fake-key-for-mocked-requests');
  let json='';
  request.setEncoding('utf8');
  request.on('data',chunk=>{json+=chunk;});
  request.on('end',()=>{
    providerCalls++;
    const body=JSON.parse(json);
    assert.equal(body.text.format.type,'json_schema');
    assert.ok(body.input[0].content.includes('不可信'));
    const noDetails=body.input[1].content.includes('仅说九月底');
    response.writeHead(200,{'content-type':'application/json'});
    response.end(JSON.stringify({output:[{content:[{
      type:'output_text',text:JSON.stringify(noDetails
        ? {assignee_hint:null,due_at:null,confidence:0.3}
        : {assignee_hint:'测试负责人',due_at:'2026-12-10T10:00:00+08:00',confidence:0.9}),
    }]}]}));
  });
});
await new Promise<void>(resolve=>fakeProvider.listen(0,'127.0.0.1',resolve));
const bound=fakeProvider.address();
if(!bound||typeof bound==='string')throw new Error('Mock provider port missing');
const mockBaseUrl='http://127.0.0.1:'+bound.port+'/v1';
try{
  process.env.AI_DAILY_REQUEST_LIMIT='4';
  const user=(await pool.query(
    "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Mock','unused') RETURNING id",
    ['mock-'+id+'@example.com'])).rows[0];
  const tenant=(await pool.query(
    "INSERT INTO tenants(name) VALUES('AI mock tenant') RETURNING id")).rows[0];
  const project=(await pool.query(
    "INSERT INTO projects(tenant_id,name,owner_id,ai_enabled) VALUES($1,'AI mocked project',$2,TRUE) RETURNING id",
    [tenant.id,user.id])).rows[0];
  const provider=(await pool.query(`INSERT INTO ai_provider_connections
    (name,base_url,api_style,api_key_ciphertext,enabled)
    VALUES($1,$2,'responses',$3,TRUE) RETURNING id`,
    ['integration-provider-'+id,mockBaseUrl,
      encryptModelKey('fake-key-for-mocked-requests')])).rows[0];
  await pool.query(`INSERT INTO ai_model_configs
    (name,model_id,provider_id,enabled,is_default)
    VALUES($1,'mock-project-model',$2,TRUE,TRUE)`,['integration-'+id,provider.id]);
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
  const claimByMessage=new Map<string,EventRow>();
  async function processWithLease(message:{
    id:string;projectId:string;content:string;projectName:string;
  }){
    let event=claimByMessage.get(message.id);
    if(!event){
      const created=(await pool.query<{id:string}>(`
        INSERT INTO outbox_events(project_id,kind,message_id)
        VALUES($1,'message.created',$2) RETURNING id`,
        [message.projectId,message.id])).rows[0];
      const next=(await claimEvents(1))[0];
      assert.equal(next.id,created.id,'Tests must acquire a real live outbox lease');
      event=next;
      claimByMessage.set(message.id,event);
    }
    return processClarification(message,event);
  }
  const answer1=await reply('负责人：测试负责人');
  assert.ok(answer1);
  assert.equal(await processWithLease({
    id:answer1.id,projectId:project.id,content:answer1.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,1);
  // Replaying a source event must not charge AI quota or emit a second response.
  await processWithLease({
    id:answer1.id,projectId:project.id,content:answer1.content,projectName:'AI mocked project',
  });
  assert.equal(providerCalls,1);
  const answer2=await reply('截止时间补充 2026-12-10T10:00:00+08:00');
  assert.ok(answer2);
  await processWithLease({
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
  assert.equal(await processWithLease({
    id:plain.id,projectId:project.id,content:plain.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,3);
  const context=await projectAnalysisContext(project.id,plain.id,1400);
  assert.ok(context.length<=1400,'Configured context budget must not be exceeded');
  assert.ok(context.includes(plain.content),'The newest user message must remain in context');
  // Unparseable dates are acknowledged but never guessed; replays cannot double-spend.
  const vague=await reply('仅说九月底');
  assert.ok(vague);
  assert.equal(await processWithLease({
    id:vague.id,projectId:project.id,content:vague.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,4);
  await processWithLease({
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
    processWithLease({
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
  assert.equal(await processWithLease({
    id:unknown.id,projectId:project.id,content:unknown.content,projectName:'AI mocked project',
  }),true);
  assert.equal(providerCalls,4,'Unrelated proposals must not trigger model calls');
  const invocations=(await pool.query(`SELECT status,authorization_version,
    input_tokens,output_tokens,input_fingerprint FROM ai_model_invocations
    WHERE project_id=$1 ORDER BY started_at`,[project.id])).rows;
  assert.equal(invocations.length,4,'One ledger row per actual upstream attempt');
  assert.ok(invocations.every(x=>x.status==='succeeded'));
  assert.ok(invocations.every(x=>Number(x.authorization_version)===1));
  assert.ok(invocations.every(x=>x.input_tokens===null&&x.output_tokens===null));
  assert.ok(invocations.every(x=>/^[a-f0-9]{64}$/.test(x.input_fingerprint)));

  console.log('AI integration passed: source-bound multi-turn evidence, replay, budget and no automatic task updates');
}finally{
  if(previousLimit===undefined)delete process.env.AI_DAILY_REQUEST_LIMIT;
  else process.env.AI_DAILY_REQUEST_LIMIT=previousLimit;
  await pool.end();
  await new Promise<void>(resolve=>fakeProvider.close(()=>resolve()));
}
