import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const port=33217;
const host='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['--import','tsx','apps/api/src/server.ts'],{
  env:{...process.env,API_PORT:String(port)},stdio:'inherit',
});
let exited=false;
server.once('exit',()=>{exited=true;});
async function waitForHealth(){
  for(let i=0;i<40;i++){
    if(exited)throw new Error('API exited before health check');
    try{const r=await fetch(host+'/health');if(r.ok)return;}catch{}
    await delay(400);
  }
  throw new Error('API did not become healthy');
}
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
const origin=process.env.WEB_ORIGIN||'http://localhost:3000';
let cookieA='',cookieB='';
async function api(path,{method='GET',body,cookie=cookieA}={}){
  const r=await fetch(host+path,{
    method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),Origin:origin,
      ...(cookie?{Cookie:cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  let data;try{data=await r.json();}catch{data={};}
  return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
}
try{
  await waitForHealth();
  const suffix=randomUUID().slice(0,8);
  const signup=await api('/auth/register',{method:'POST',cookie:'',body:{
    email:'first+'+suffix+'@example.com',password:'Passw0rd-Strong-123',displayName:'张工',
  }});
  assert.equal(signup.status,200,JSON.stringify(signup.data));
  cookieA=signup.cookie;assert.ok(cookieA);
  const uid=signup.data.user.id;
  const created=await api('/projects',{method:'POST',body:{name:'集成测试项目',timezone:'Asia/Shanghai'}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const pid=created.data.project.id;
  assert.equal(created.data.project.ai_enabled,false);
  const suffix2=randomUUID().slice(0,8);
  const second=await api('/auth/register',{method:'POST',cookie:'',body:{
    email:'second+'+suffix2+'@example.com',password:'Passw0rd-Strong-123',displayName:'李工',
  }});
  assert.equal(second.status,200,JSON.stringify(second.data));
  cookieB=second.cookie;assert.ok(cookieB);
  const forbidden=await api('/projects/'+pid+'/messages',{cookie:cookieB});
  assert.equal(forbidden.status,404,'Cross-project read must not be allowed');
  const denied=await api('/projects/'+pid+'/tasks',{method:'POST',cookie:cookieB,
    body:{title:'越权任务',assigneeId:null,dueAt:null}});
  assert.equal(denied.status,404,'Cross-project write must not be allowed');
  const invited=await api('/projects/'+pid+'/members',{method:'POST',body:{
    email:'second+'+suffix2+'@example.com',
  }});
  assert.equal(invited.status,200,'Owner should be able to add a registered project member');
  const memberView=await api('/projects/'+pid+'/members',{cookie:cookieB});
  assert.equal(memberView.status,200);
  const ownerOnly=await api('/projects/'+pid+'/settings',{method:'PATCH',cookie:cookieB,
    body:{aiEnabled:false,workStart:9,workEnd:18,cooldownHours:24}});
  assert.equal(ownerOnly.status,403,'Project members cannot change AI or reminder policy');
  const before=await api('/projects/'+pid+'/messages');
  assert.equal(before.status,200);
  const nonce=randomUUID();
  const body={content:'接口周三计划交付。',nonce};
  const posted=await api('/projects/'+pid+'/messages',{method:'POST',body});
  assert.equal(posted.status,201,JSON.stringify(posted.data));
  const duplicate=await api('/projects/'+pid+'/messages',{method:'POST',body});
  assert.equal(duplicate.status,201);
  assert.equal(posted.data.message.id,duplicate.data.message.id,'Message retry must be idempotent');
  const messages=await api('/projects/'+pid+'/messages');
  assert.equal(messages.data.messages.length,1);
  // Holding the project message lock simulates a message transaction that commits late.
  // A later request must not allocate/commit a higher cursor before this one commits.
  await db.query('BEGIN');
  let unlocked=false;
  try{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      ['chatpm:messages:'+pid]);
    const earlier=(await db.query(
      `INSERT INTO messages(project_id,author_id,kind,content,client_nonce)
       VALUES($1,$2,'user','先开始的事务',$3) RETURNING seq`,
      [pid,uid,randomUUID()])).rows[0];
    const pending=api('/projects/'+pid+'/messages',{method:'POST',
      body:{content:'后开始的事务',nonce:randomUUID()}});
    const completedBeforeCommit=await Promise.race([
      pending.then(()=>true),delay(200).then(()=>false),
    ]);
    assert.equal(completedBeforeCommit,false,'Concurrent message must wait for earlier commit');
    await db.query('COMMIT');
    unlocked=true;
    const later=await pending;
    assert.equal(later.status,201,JSON.stringify(later.data));
    assert.ok(BigInt(later.data.message.seq)>BigInt(earlier.seq));
    const delta=await api('/projects/'+pid+'/messages?after='+earlier.seq);
    assert.ok(delta.data.messages.some(m=>m.id===later.data.message.id),
      'Incremental cursor must never skip a late-committing message');
  }finally{
    if(!unlocked)await db.query('ROLLBACK');
  }
  const task=await api('/projects/'+pid+'/tasks',{method:'POST',
    body:{title:'正式任务',detail:'',assigneeId:uid,dueAt:null}});
  assert.equal(task.status,201,JSON.stringify(task.data));
  const tid=task.data.task.id;
  const changed=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',
    body:{status:'doing',version:1}});
  assert.equal(changed.status,200);
  const stale=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',
    body:{status:'done',version:1}});
  assert.equal(stale.status,409,'Stale versions must not overwrite task state');
  const edited=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',body:{
    version:2,assigneeId:uid,dueAt:new Date(Date.now()+86400000).toISOString(),
  }});
  assert.equal(edited.status,200,'Owner may edit task plan');
  const configured=await api('/projects/'+pid+'/settings',{method:'PATCH',body:{
    aiEnabled:false,workStart:9,workEnd:18,cooldownHours:24,
  }});
  assert.equal(configured.status,200);
  const followup=await db.query(
    'SELECT active FROM followup_plans WHERE task_id=$1',[tid]);
  assert.equal(followup.rows[0]?.active,true,'Task follow-up must be durable');
  await db.query(
    "UPDATE followup_plans SET last_sent_at=NOW(),next_at=NOW()+INTERVAL '24 hours' WHERE task_id=$1",
    [tid]);
  const replanned=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',
    body:{version:edited.data.task.version,
      dueAt:new Date(Date.now()+3*3600000).toISOString()}});
  assert.equal(replanned.status,200,'Replanning should succeed');
  const cooldown=await db.query(
    "SELECT next_at >= last_sent_at + INTERVAL '24 hours' AS preserved FROM followup_plans WHERE task_id=$1",
    [tid]);
  assert.equal(cooldown.rows[0]?.preserved,true,'Replanning must preserve last reminder cooldown');

  const candidate=(await db.query(
    `INSERT INTO proposed_changes(project_id,source_message_id,kind,title,detail)
     VALUES($1,$2,'task',$3,'请核对') RETURNING id`,
    [pid,posted.data.message.id,'来自聊天的候选任务'])).rows[0];
  const memberDenied=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',cookie:cookieB,body:{decision:'accepted',assigneeId:second.data.user.id}});
  assert.equal(memberDenied.status,403,'Only the project owner may approve AI proposals');
  const accepted=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',body:{decision:'accepted',assigneeId:second.data.user.id}});
  assert.equal(accepted.status,200);
  const duplicateApproval=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',body:{decision:'accepted',assigneeId:second.data.user.id}});
  assert.equal(duplicateApproval.status,409,'Proposal must not create duplicate tasks');
  const linked=await db.query('SELECT id FROM tasks WHERE source_proposal_id=$1',[candidate.id]);
  assert.equal(linked.rowCount,1);

  // Stats must count the entire project, not only the first 200 listed tasks.
  await db.query(
    "INSERT INTO tasks(project_id,title) SELECT $1,'批量任务-'||n FROM generate_series(1,205) AS n",
    [pid]);
  const beforeCount=Number((await db.query(
    'SELECT COUNT(*) AS total FROM tasks WHERE project_id=$1',[pid])).rows[0].total);
  const report=await api('/projects/'+pid+'/reports',{method:'POST',body:{kind:'week'}});
  assert.equal(report.status,200,JSON.stringify(report.data));
  assert.equal(report.data.report.state,'draft');
  assert.ok(report.data.report.content.includes('总数：'+beforeCount+'；'),
    'Report counts must not be truncated to 200');
  const changedTask=await api('/projects/'+pid+'/tasks',{method:'POST',
    body:{title:'晚于草稿新增的任务',assigneeId:null,dueAt:null}});
  assert.equal(changedTask.status,201);
  const refreshed=await api('/projects/'+pid+'/reports',{method:'POST',body:{kind:'week'}});
  assert.equal(refreshed.data.report.id,report.data.report.id);
  assert.ok(refreshed.data.report.content.includes('总数：'+(beforeCount+1)+'；'),
    'Regenerated draft must reflect new data');
  const published=await api('/projects/'+pid+'/reports/'+report.data.report.id+'/publish',{method:'POST'});
  assert.equal(published.status,200);
  const immutable=await api('/projects/'+pid+'/reports',{method:'POST',body:{kind:'week'}});
  assert.equal(immutable.data.report.content,refreshed.data.report.content,
    'Published reports must remain immutable');
  console.log('API smoke tests passed: access control, ordered chat, idempotency, cooldown, full report counts and immutable publication.');
}finally{
  await db.end();
  server.kill('SIGTERM');
  await delay(250);
}
