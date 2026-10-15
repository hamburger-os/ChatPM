'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Message,Person, Progress, Project, Proposal, Report, Risk, Task, User } from './client';
import { json, request } from './client';
import PmRegisterPanel from './PmRegisterPanel';
import RiskRegisterItem from './RiskRegisterItem';

type Tab='tasks'|'governance'|'proposals'|'reports'|'settings';
export default function WorkspaceDetails({project,user,messages}:{
  project:Project|null;user:User;messages:Message[];
}){
  const [tab,setTab]=useState<Tab>('tasks');
  const [tasks,setTasks]=useState<Task[]>([]);
  const [people,setPeople]=useState<Person[]>([]);
  const [risks,setRisks]=useState<Risk[]>([]);
  const [proposals,setProposals]=useState<Proposal[]>([]);
  const [progress,setProgress]=useState<Progress[]>([]);
  const [reports,setReports]=useState<Report[]>([]);
  const [taskName,setTaskName]=useState('');
  const [assignee,setAssignee]=useState('');
  const [due,setDue]=useState('');
  const [email,setEmail]=useState('');
  const [nextOwnerId,setNextOwnerId]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const createTaskIntent=useRef<string|null>(null);
  const updateTaskIntents=useRef(new Map<string,string>());
  const reviewIntents=useRef(new Map<string,string>());
  const reportIntents=useRef(new Map<string,string>());
  const riskIntents=useRef(new Map<string,string>());
  const governanceIntents=useRef(new Map<string,string>());
  const [settingsRevision,setSettingsRevision]=useState(1);
  const [settings,setSettings]=useState({aiEnabled:false,workStart:null as number|null,
    workEnd:null as number|null,cooldownHours:null as number|null});
  const [savedSettings,setSavedSettings]=useState(settings);
  const settingsDirty=settings.aiEnabled!==savedSettings.aiEnabled||
    settings.workStart!==savedSettings.workStart||
    settings.workEnd!==savedSettings.workEnd||
    settings.cooldownHours!==savedSettings.cooldownHours;
  const id=project?.id;
  const owner=project?.role==='owner',manager=owner||project?.role==='manager';
  async function reload(pid:string){
    const base='/projects/'+pid;
    const [t,m,r,p,u,reports]=await Promise.all([
      request<{tasks:Task[]}>(base+'/tasks'),
      request<{members:Person[]}>(base+'/members'),
      request<{risks:Risk[]}>(base+'/risks'),
      request<{proposals:Proposal[]}>(base+'/proposals'),
      request<{updates:Progress[]}>(base+'/progress'),
      request<{reports:Report[]}>(base+'/reports'),
    ]);
    return {tasks:t.tasks,people:m.members,risks:r.risks,proposals:p.proposals,
      progress:u.updates,reports:reports.reports};
  }
  useEffect(()=>{
    if(!id||!project)return;
    let active=true;
    setTab('tasks');
    setNextOwnerId('');
    setSettingsRevision(project.settings_revision);
    const loadedSettings={aiEnabled:project.ai_enabled,workStart:project.work_start,
      workEnd:project.work_end,cooldownHours:project.cooldown_hours};
    setSettings(loadedSettings);
    setSavedSettings(loadedSettings);
    let inFlight=false;
    const update=async()=>{
      if(!active||document.hidden||inFlight)return;
      inFlight=true;
      try{
        const x=await reload(id);
        if(!active)return;
        setTasks(x.tasks);setPeople(x.people);setRisks(x.risks);
        setProposals(x.proposals);setProgress(x.progress);setReports(x.reports);
      }catch(e){if(active)setNotice(e instanceof Error?e.message:'刷新失败');}
      finally{inFlight=false;}
    };
    void update();
    const interval=setInterval(()=>void update(),15000);
    const visible=()=>{if(!document.hidden)void update();};
    document.addEventListener('visibilitychange',visible);
    return ()=>{active=false;clearInterval(interval);document.removeEventListener('visibilitychange',visible);};
  },[id]);
  async function act(fn:()=>Promise<void>){
    if(!id)return;
    setBusy(true);setNotice('');
    try{await fn();const x=await reload(id);
      setTasks(x.tasks);setPeople(x.people);setRisks(x.risks);
      setProposals(x.proposals);setProgress(x.progress);setReports(x.reports);
    }catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setBusy(false);}
  }
  const base='/projects/'+id;
  function createTask(e:FormEvent){
    e.preventDefault();
    const idempotencyKey=createTaskIntent.current??crypto.randomUUID();
    createTaskIntent.current=idempotencyKey;
    void act(async()=>{
      await request(base+'/tasks',{method:'POST',body:json({idempotencyKey,
        title:taskName,assigneeId:assignee||null,dueDate:due||null})});
      createTaskIntent.current=null;
      setTaskName('');setAssignee('');setDue('');
    });
  }
  function patchTask(task:Task,change:Record<string,unknown>){
    const intent=JSON.stringify([id,task.id,task.version,change]);
    const idempotencyKey=updateTaskIntents.current.get(intent)??crypto.randomUUID();
    updateTaskIntents.current.set(intent,idempotencyKey);
    void act(async()=>{
      await request(base+'/tasks/'+task.id,{method:'PATCH',
        body:json({idempotencyKey,version:task.version,...change})});
      updateTaskIntents.current.delete(intent);
    });
  }
  function reviewCommand(path:string,decision:'accepted'|'rejected',
    input:Record<string,unknown>={}){
    const signature=JSON.stringify([id,path,decision,input]);
    const idempotencyKey=reviewIntents.current.get(signature)??crypto.randomUUID();
    reviewIntents.current.set(signature,idempotencyKey);
    void act(async()=>{
      await request(base+path,{method:'POST',
        body:json({idempotencyKey,decision,...input})});
      reviewIntents.current.delete(signature);
    });
  }
  function decide(p:Proposal,decision:'accepted'|'rejected',
    assigneeId:string|null=null,dueDate?:string|null){
    reviewCommand('/proposals/'+p.id+'/decision',decision,{assigneeId,dueDate});
  }
  function governanceCommand(path:string,method:'POST'|'PATCH'|'DELETE',
    data:Record<string,unknown>={},onSuccess?:(result:{settingsRevision?:number})=>void){
    const signature=JSON.stringify([id,path,method,data]);
    const idempotencyKey=governanceIntents.current.get(signature)??crypto.randomUUID();
    governanceIntents.current.set(signature,idempotencyKey);
    void act(async()=>{
      const result=await request<{settingsRevision?:number}>(base+path,{
        method,body:json({idempotencyKey,...data}),
      });
      governanceIntents.current.delete(signature);
      onSuccess?.(result);
    });
  }
  function riskCommand(path:string,method:'PATCH'|'POST',
    details:Record<string,unknown>){
    const intent=JSON.stringify([id,path,method,details]);
    const idempotencyKey=riskIntents.current.get(intent)??crypto.randomUUID();
    riskIntents.current.set(intent,idempotencyKey);
    void act(async()=>{
      await request(base+path,{method,body:json({idempotencyKey,...details})});
      riskIntents.current.delete(intent);
    });
  }
  function reportCommand(path:string,details:Record<string,unknown>){
    const intent=JSON.stringify([id,path,details]);
    const idempotencyKey=reportIntents.current.get(intent)??crypto.randomUUID();
    reportIntents.current.set(intent,idempotencyKey);
    void act(async()=>{
      await request(base+path,{method:'POST',body:json({idempotencyKey,...details})});
      reportIntents.current.delete(intent);
    });
  }
  return <aside className="details">
    <div className="tabs">
      {(['tasks','governance','proposals','reports','settings'] as Tab[]).map(t=>
        <button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>
          {({tasks:'任务',governance:'项目治理',proposals:'AI 待确认',reports:'汇报',settings:'项目设置'})[t]}
        </button>)}
    </div>
    <div className="detail-content">
    {!project&&<p className="hint">请先选择或创建项目。</p>}
    {project&&tab==='tasks'&&<>
      <h3>待审核的进度证据 ({progress.filter(x=>x.status==='pending').length})</h3>
      {progress.filter(x=>x.status==='pending').map(x=><article className="item" key={x.id}>
        <strong>{x.task_title}</strong><p>{x.summary}</p><small>{x.kind}</small>
        {manager&&<div className="actions">
          <button disabled={busy} onClick={()=>reviewCommand('/progress/'+x.id+'/decision','accepted')}>确认进度</button>
          <button disabled={busy} className="secondary" onClick={()=>reviewCommand('/progress/'+x.id+'/decision','rejected')}>忽略</button>
        </div>}
      </article>)}
      <h3>正式任务 ({tasks.length})</h3>
      {manager&&<form className="stack" onSubmit={createTask}>
        <input required placeholder="任务名称" value={taskName} onChange={e=>{setTaskName(e.target.value);createTaskIntent.current=null;}}/>
        <select aria-label="任务负责人" value={assignee} onChange={e=>{setAssignee(e.target.value);createTaskIntent.current=null;}}>
          <option value="">负责人待定</option>{people.filter(x=>x.role!=='observer').map(x=>
            <option value={x.id} key={x.id}>{x.display_name}</option>)}
        </select>
        <input aria-label="任务截止日期" type="date" value={due} onChange={e=>{setDue(e.target.value);createTaskIntent.current=null;}}/>
        <button disabled={busy}>创建任务</button>
      </form>}
      {tasks.map(task=><article className="item" key={task.id}>
        <strong>{task.title}</strong>
        <small>负责人：{task.assignee||'待指派'} · 截止：{task.due_date||'未设置'}</small>
        <select aria-label={'任务状态：'+task.title} value={task.status}
          disabled={busy||!(manager||(project.role==='member'&&task.assignee_id===user.id))}
          onChange={e=>patchTask(task,{status:e.target.value})}>
          <option value="todo">待开始</option><option value="doing">进行中</option>
          <option value="blocked">阻塞</option><option value="done">已完成</option>
          <option value="cancelled">已取消</option>
        </select>
        {manager&&<div className="task-options">
          <label>负责人<select value={task.assignee_id||''} onChange={e=>patchTask(task,{assigneeId:e.target.value||null})}>
            <option value="">未指定</option>{people.filter(x=>x.role!=='observer').map(x=>
              <option value={x.id} key={x.id}>{x.display_name}</option>)}
          </select></label>
          <label>截止日期<input key={task.id+':'+task.version} type="date"
            defaultValue={task.due_date||''} onBlur={e=>{
              if(e.target.value!==(task.due_date||''))patchTask(task,{dueDate:e.target.value||null});
            }}/></label>
        </div>}
      </article>)}
      <h3>当前风险 ({risks.length})</h3>
      {risks.map(x=><RiskRegisterItem key={x.id+':'+x.version}
        risk={x} people={people} projectId={id!} canManage={Boolean(manager)}
        busy={busy}
        onAssess={data=>riskCommand('/risks/'+x.id+'/assessment','PATCH',
          {...data,expectedVersion:x.version})}
        onTransition={(decision,note)=>riskCommand(
          '/risks/'+x.id+'/transition','POST',
          {decision,note,expectedVersion:x.version})}/>)}
    </>}
    {project&&tab==='governance'&&<PmRegisterPanel key={project.id}
      project={project} user={user} people={people} tasks={tasks} messages={messages}/>}
    {project&&tab==='proposals'&&<>
      <h3>AI 候选事项</h3><p className="hint">AI 仅生成建议，不会直接修改正式任务。</p>
      {proposals.filter(p=>p.status==='pending').map(p=><ProposalItem
        key={p.id} proposal={p} people={people} manager={Boolean(manager)} busy={busy}
        onDecide={decide}/>)}
    </>}
    {project&&tab==='reports'&&<>
      <h3>周报与月报</h3>
      {owner&&<div className="actions">
        {(['week','month'] as const).map(kind=><button key={kind} disabled={busy}
          onClick={()=>reportCommand('/reports',{kind})}>生成{kind==='week'?'周':'月'}报</button>)}
      </div>}
      {reports.map(x=><details className="item" key={x.id}>
        <summary><strong>{x.kind==='week'?'周报':'月报'} · {x.period_key}</strong>
          <small> · v{x.revision} · {x.state==='published'?'已发布':'草稿'}</small></summary>
        <pre>{x.content}</pre>
        {owner&&x.state==='draft'&&<button disabled={busy} onClick={()=>
          reportCommand('/reports/'+x.id+'/publish',
            {expectedRevision:x.revision})}>审核并发布</button>}
      </details>)}
    </>}
    {project&&tab==='settings'&&<>
      <h3>项目成员</h3>
      {people.map(x=><div className="member" key={x.id}>
        <strong>{x.display_name}</strong><small>{x.email}</small>
        {owner&&x.role!=='owner'?<div className="actions">
          <select aria-label={'角色：'+x.display_name}
            disabled={busy} value={x.role} onChange={e=>
              governanceCommand('/members/'+x.id,'PATCH',{role:e.target.value})}>
            <option value="manager">项目管理者</option>
            <option value="member">项目成员</option>
            <option value="observer">观察者</option>
          </select>
          <button className="secondary" disabled={busy} onClick={()=>{
            if(window.confirm('确定将 '+x.display_name+' 移出当前项目？未完成任务需先移交。'))
              governanceCommand('/members/'+x.id,'DELETE');
          }}>移除</button>
        </div>:<small>{x.role}</small>}
      </div>)}
      {owner&&<form className="row-form" onSubmit={e=>{e.preventDefault();
        governanceCommand('/members','POST',{email},()=>setEmail(''));
      }}>
        <input type="email" placeholder="添加组织内已注册成员" required value={email} onChange={e=>setEmail(e.target.value)}/>
        <button disabled={busy}>加入</button>
      </form>}
      {owner&&<div className="stack">
        <h3>正式项目负责人移交</h3>
        <p className="hint">移交后新负责人拥有项目管理权限，当前负责人自动变为项目管理者。
          此操作不会改变系统 AI 模型与密钥配置。</p>
        <label>接任负责人
          <select value={nextOwnerId} disabled={busy}
            onChange={e=>setNextOwnerId(e.target.value)}>
            <option value="">请选择已加入项目的成员</option>
            {people.filter(x=>x.role!=='owner').map(x=>
              <option value={x.id} key={x.id}>{x.display_name}（{x.role}）</option>)}
          </select>
        </label>
        <small>负责人版本：v{project.ownership_revision}</small>
        <button disabled={busy||!nextOwnerId} onClick={()=>{
          const candidate=people.find(x=>x.id===nextOwnerId);
          if(candidate&&window.confirm('确定将项目负责人移交给 '+candidate.display_name+
            '？你将变为项目管理者。'))
            governanceCommand('/ownership-transfer','POST',
              {targetUserId:nextOwnerId,expectedRevision:project.ownership_revision},
              ()=>window.location.reload());
        }}>确认移交项目负责人</button>
      </div>}
      {owner&&<div className="stack">
        <h3>AI 助手</h3>
        <label className="check"><input type="checkbox" checked={settings.aiEnabled}
          onChange={e=>setSettings({...settings,aiEnabled:e.target.checked})}/>启用 AI 消息分析</label>
        <p className="hint">供应商、模型与密钥由系统管理员在「系统管理」中统一维护。</p>
        <h3>工作日提醒</h3>
        <label className="check"><input type="checkbox" checked={settings.workStart!==null}
          onChange={e=>setSettings({...settings,workStart:e.target.checked?9:null,
            workEnd:e.target.checked?18:null,cooldownHours:e.target.checked?24:null})}/>启用提醒</label>
        {settings.workStart!==null&&<div className="triple">
          {(['workStart','workEnd','cooldownHours'] as const).map(field=><label key={field}>{({workStart:'开始时间（时）',workEnd:'结束时间（时）',cooldownHours:'提醒间隔（小时）'})[field]}
            <input type="number" value={settings[field]??''} onChange={e=>setSettings({...settings,
              [field]:e.target.value===''?null:Number(e.target.value)})}/></label>)}
        </div>}
        <small>当前设置版本：v{settingsRevision}</small>
        <button disabled={busy||!settingsDirty} onClick={()=>
          governanceCommand('/settings','PATCH',{...settings,expectedRevision:settingsRevision},
            result=>{
              if(result.settingsRevision){
                setSettingsRevision(result.settingsRevision);
                setSavedSettings({...settings});
              }
            })
        }>保存设置</button>
      </div>}
    </>}
    {notice&&<p role="alert" className="notice">{notice}</p>}
    </div>
  </aside>;
}
function ProposalItem({proposal:p,people,manager,busy,onDecide}:{
  proposal:Proposal;people:Person[];manager:boolean;busy:boolean;
  onDecide:(p:Proposal,d:'accepted'|'rejected',a?:string|null,date?:string|null)=>void;
}){
  const [assignee,setAssignee]=useState('');
  const [date,setDate]=useState('');
  return <article className="item">
    <strong>{p.title}</strong><p>{p.detail}</p>
    <small>{p.kind==='risk'?'风险':'任务'} · {p.evidence_text||'待核实'}</small>
    {manager&&<>
      {p.kind==='task'&&<><select value={assignee} onChange={e=>setAssignee(e.target.value)}>
        <option value="">待指派</option>{people.filter(x=>x.role!=='observer').map(x=>
          <option value={x.id} key={x.id}>{x.display_name}</option>)}
      </select><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></>}
      <div className="actions">
        <button disabled={busy} onClick={()=>onDecide(p,'accepted',assignee||null,date||undefined)}>确认</button>
        <button disabled={busy} className="secondary" onClick={()=>onDecide(p,'rejected')}>忽略</button>
      </div>
    </>}
  </article>;
}
