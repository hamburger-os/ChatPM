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

  const report=await api('/projects/'+pid+'/reports',{method:'POST',body:{kind:'week'}});
  assert.equal(report.status,200,JSON.stringify(report.data));
  assert.equal(report.data.report.state,'draft');
  const published=await api('/projects/'+pid+'/reports/'+report.data.report.id+'/publish',{method:'POST'});
  assert.equal(published.status,200);
  console.log('API smoke tests passed: tenancy, RBAC, deduplicated chat/proposals, task versioning, durable follow-ups, report publication.');
}finally{
  await db.end();
  server.kill('SIGTERM');
  await delay(250);
}
