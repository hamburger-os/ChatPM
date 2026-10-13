import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

// End-to-end bounded Worker integration with a local mock model. No actual vendor key.
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/responses'){res.writeHead(404).end();return;}
  let raw='';
  for await(const chunk of req)raw+=chunk.toString('utf8');
  const body=JSON.parse(raw);
  assert.ok(body.input[1].content.includes(taskId),'Model must receive source task ID');
  modelCalls++;
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({status:'completed',output:[{content:[{
    type:'output_text',text:JSON.stringify({items:[],progress:[{
      task_id:taskId,kind:'progress',summary:'设计初稿已完成，仍需评审',
    }]}),
  }]}]}));
});
let worker;
let modelCalls=0;
let taskId='';
await db.connect();
try{
  const suffix=randomUUID();
  const user=(await db.query(`INSERT INTO users(email,display_name,password_hash)
    VALUES($1,'Worker Test','unused') RETURNING id`,['worker-'+suffix+'@example.com'])).rows[0];
  const tenant=(await db.query(`INSERT INTO tenants(name) VALUES('Worker progress test')
    RETURNING id`)).rows[0];
  const project=(await db.query(`INSERT INTO projects(tenant_id,name,owner_id,ai_enabled)
    VALUES($1,'Worker project', $2,TRUE) RETURNING id`,[tenant.id,user.id])).rows[0];
  const task=(await db.query(`INSERT INTO tasks(project_id,title,status,due_date)
    VALUES($1,'评估测试系统的方案设计','doing','2026-12-15') RETURNING id`,
    [project.id])).rows[0];
  taskId=task.id;
  const source=(await db.query(`INSERT INTO messages(
    project_id,author_id,kind,content,client_nonce)
    VALUES($1,$2,'user','评估测试系统的方案设计初稿已经完成，准备评审。',$3) RETURNING id`,
    [project.id,user.id,randomUUID()])).rows[0];
  await db.query(`INSERT INTO outbox_events(project_id,kind,message_id)
    VALUES($1,'message.created',$2)`,[project.id,source.id]);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  worker=spawn(process.execPath,['--import','tsx','apps/worker/src/worker.ts'],{
    env:{...process.env,LLM_API_KEY:'mock-worker-key',LLM_BASE_URL:'http://127.0.0.1:'+port,
      LLM_MODEL:'mock-project-model',LLM_API_STYLE:'responses'},
    stdio:'ignore',
  });
  let done=false;
  for(let i=0;i<55;i++){
    const {rows}=await db.query(`SELECT id FROM task_progress_updates
      WHERE project_id=$1 AND task_id=$2 AND source_message_id=$3`,
      [project.id,taskId,source.id]);
    if(rows.length){done=true;break;}
    if(worker.exitCode!==null)break;
    await sleep(300);
  }
  assert.ok(done,'Worker must persist a progress proposal linked to the formal task');
  const bad=(await db.query(`SELECT 1 FROM proposed_changes WHERE project_id=$1`,
    [project.id])).rowCount;
  assert.equal(bad,0,'A progress update must not become a duplicate new task');
  const status=(await db.query(`SELECT status FROM tasks WHERE id=$1`,[taskId])).rows[0].status;
  assert.equal(status,'doing','Unapproved model evidence cannot close the formal task');
  assert.equal(modelCalls,1);
} finally{
  if(worker&&worker.exitCode===null){
    worker.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>worker.once('exit',resolve)),sleep(5000)]);
    if(worker.exitCode===null)worker.kill('SIGKILL');
  }
  await new Promise(resolve=>server.close(resolve));
  await db.end();
}
