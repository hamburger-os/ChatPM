'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

type User={id:string,email:string,display_name:string};
type Project={id:string,name:string,role:'owner'|'member',ai_enabled:boolean,
  timezone:string,work_start:number|null,work_end:number|null,cooldown_hours:number|null};
type Member={id:string,email:string,display_name:string,role:string};
type Message={id:string,seq:number,kind:string,content:string,author:string|null,created_at:string};
type Task={id:string,title:string,status:string,version:number,assignee_id:string|null,
  assignee:string|null,due_at:string|null};
type Proposal={id:string,kind:'task'|'risk',title:string,detail:string,assignee_hint:string|null,
  due_at:string|null,status:string,confidence:string};
type Report={id:string,kind:'week'|'month',period_key:string,content:string,
  state:'draft'|'published'};
type Risk={id:string,title:string,status:string};
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:3001';

async function request<T>(path:string,options?:RequestInit):Promise<T>{
  const response=await fetch(API+path,{...options,credentials:'include',cache:'no-store',
    headers:{'Content-Type':'application/json',...options?.headers}});
  const result=await response.json().catch(()=>({error:'服务暂时不可用'}));
  if(!response.ok)throw new Error(result.error||'请求失败');
  return result as T;
}

export default function Home(){
  const [user,setUser]=useState<User|null>(null);
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),
    [displayName,setDisplayName]=useState('');
  const [projects,setProjects]=useState<Project[]>([]),[selected,setSelected]=useState<string|null>(null);
  const [members,setMembers]=useState<Member[]>([]),[messages,setMessages]=useState<Message[]>([]);
  const [tasks,setTasks]=useState<Task[]>([]),[proposals,setProposals]=useState<Proposal[]>([]);
  const [reports,setReports]=useState<Report[]>([]),[risks,setRisks]=useState<Risk[]>([]);
  const [chat,setChat]=useState(''),[newProject,setNewProject]=useState(''),
    [newTask,setNewTask]=useState(''),[invite,setInvite]=useState('');
  const [settings,setSettings]=useState({aiEnabled:false,workStart:null as number|null,
    workEnd:null as number|null,cooldownHours:null as number|null});
  const [notice,setNotice]=useState(''),[working,setWorking]=useState(false);
  const [tab,setTab]=useState<'tasks'|'proposals'|'reports'|'settings'>('tasks');
  const bottom=useRef<HTMLDivElement>(null);
  const current=projects.find(p=>p.id===selected);

  const loadProjects=useCallback(async()=>{
    const data=await request<{projects:Project[]}>('/projects');
    setProjects(data.projects);
    setSelected(s=>s && data.projects.some(p=>p.id===s)?s:data.projects[0]?.id||null);
  },[]);
  useEffect(()=>{
    request<{user:User}>('/me').then(x=>{setUser(x.user);return loadProjects();})
      .catch(()=>setUser(null));
  },[loadProjects]);

  const refresh=useCallback(async(id:string)=>{
    const base='/projects/'+id;
    const [ms,ts,ps,rs,people,risk]=await Promise.all([
      request<{messages:Message[]}>(base+'/messages'),
      request<{tasks:Task[]}>(base+'/tasks'),
      request<{proposals:Proposal[]}>(base+'/proposals'),
      request<{reports:Report[]}>(base+'/reports'),
      request<{members:Member[]}>(base+'/members'),
      request<{risks:Risk[]}>(base+'/risks'),
    ]);
    setMessages(ms.messages);setTasks(ts.tasks);setProposals(ps.proposals);
    setReports(rs.reports);setMembers(people.members);setRisks(risk.risks);
  },[]);
  useEffect(()=>{
    if(!selected)return;
    const id=selected;
    setMessages([]);setTasks([]);setProposals([]);setReports([]);
    const update=()=>void refresh(id).catch(e=>setNotice(e.message));
    update();
    const timer=setInterval(update,5000);
    return ()=>clearInterval(timer);
  },[selected,refresh]);
  useEffect(()=>{ if(current) setSettings({
    aiEnabled:current.ai_enabled,workStart:current.work_start,
    workEnd:current.work_end,cooldownHours:current.cooldown_hours});
  },[current?.id,current?.ai_enabled,current?.work_start,current?.work_end,current?.cooldown_hours]);
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[messages.length]);

  async function action(fn:()=>Promise<void>) {
    setNotice('');setWorking(true);
    try {await fn();}catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally {setWorking(false);}
  }
  async function auth(e:FormEvent){
    e.preventDefault();
    await action(async()=>{
      const path=mode==='login'?'/auth/login':'/auth/register';
      const data=await request<{user:User}>(path,{
        method:'POST',body:JSON.stringify({email,password,displayName})});
      setUser(data.user);setPassword('');await loadProjects();
    });
  }
  async function createProject(e:FormEvent) {
    e.preventDefault();
    await action(async()=>{
      const p=await request<{project:Project}>('/projects',{
        method:'POST',body:JSON.stringify({name:newProject,timezone:'Asia/Shanghai'})});
      setNewProject('');await loadProjects();setSelected(p.project.id);
    });
  }
  async function send(e:FormEvent){
    e.preventDefault();
    if(!selected||!chat.trim())return;
    const content=chat.trim();
    await action(async()=>{
      await request('/projects/'+selected+'/messages',{
        method:'POST',body:JSON.stringify({content,nonce:crypto.randomUUID()})});
      setChat('');await refresh(selected);
    });
  }
  async function createTask(e:FormEvent) {
    e.preventDefault();if(!selected||!newTask.trim())return;
    await action(async()=>{
      await request('/projects/'+selected+'/tasks',{method:'POST',
        body:JSON.stringify({title:newTask,detail:'',dueAt:null,assigneeId:null})});
      setNewTask('');await refresh(selected);
    });
  }
  async function changeStatus(task:Task,status:string){
    if(!selected)return;
    await action(async()=>{
      await request('/projects/'+selected+'/tasks/'+task.id,{method:'PATCH',
        body:JSON.stringify({version:task.version,status})});
      await refresh(selected);
    });
  }
  async function decision(p:Proposal,accepted:boolean){
    if(!selected)return;
    await action(async()=>{
      const assigneeId=accepted&&p.kind==='task'
        ?window.prompt('负责人 ID（可留空；在“成员”区域查看 ID）','')||null:null;
      await request('/projects/'+selected+'/proposals/'+p.id+'/decision',{
        method:'POST',body:JSON.stringify({decision:accepted?'accepted':'rejected',assigneeId})});
      await refresh(selected);
    });
  }
  async function makeReport(kind:'week'|'month') {
    if(!selected)return;
    await action(async()=>{
      await request('/projects/'+selected+'/reports',{method:'POST',
        body:JSON.stringify({kind})});
      await refresh(selected);setTab('reports');
    });
  }
  async function saveSettings(){
    if(!selected)return;
    await action(async()=>{
      await request('/projects/'+selected+'/settings',{
        method:'PATCH',body:JSON.stringify(settings)});
      await loadProjects();setNotice('已保存项目设置');
    });
  }
  async function inviteMember(e:FormEvent){
    e.preventDefault();if(!selected)return;
    await action(async()=>{
      await request('/projects/'+selected+'/members',{
        method:'POST',body:JSON.stringify({email:invite})});
      setInvite('');await refresh(selected);
    });
  }
  async function publish(report:Report){
    if(!selected)return;
    await action(async()=>{
      await request('/projects/'+selected+'/reports/'+report.id+'/publish',{method:'POST'});
      await refresh(selected);
    });
  }
  async function logout(){
    await request('/auth/logout',{method:'POST'});
    setUser(null);setProjects([]);setSelected(null);
  }

  if(!user)return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand"><span className="brand-icon">✳</span> ChatPM</div>
      <h1>让项目主动向前</h1>
      <p>团队在聊天室里自然协作，AI 协助提取任务、跟进风险与生成汇报。</p>
      <form onSubmit={auth} className="stack">
        {mode==='register'&&<label>昵称<input value={displayName} required
          onChange={e=>setDisplayName(e.target.value)}/></label>}
        <label>邮箱<input type="email" autoComplete="username" value={email} required
          onChange={e=>setEmail(e.target.value)}/></label>
        <label>密码<input type="password" autoComplete={mode==='login'?'current-password':'new-password'}
          minLength={mode==='register'?10:1} value={password} required
          onChange={e=>setPassword(e.target.value)}/></label>
        <button disabled={working}>{mode==='login'?'登录':'注册并创建团队'}</button>
      </form>
      <button className="text-button" onClick={()=>setMode(mode==='login'?'register':'login')}>
        {mode==='login'?'没有账号？创建新团队':'已有账号？登录'}
      </button>
      {notice&&<p className="notice">{notice}</p>}
    </section>
  </main>;

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">✳</span> ChatPM</div>
      <p className="section-label">我的项目</p>
      <nav>{projects.map(p=><button key={p.id}
        className={'project '+(p.id===selected?'selected':'')}
        onClick={()=>{setSelected(p.id);setTab('tasks');}}>
        <span>◉</span> {p.name}</button>)}</nav>
      <form className="stack new-project" onSubmit={createProject}>
        <label>创建项目<input placeholder="例如：支付系统上线" value={newProject} required
          onChange={e=>setNewProject(e.target.value)}/></label>
        <button disabled={working}>＋ 新项目</button>
      </form>
      <div className="sidebar-footer">
        <strong>{user.display_name}</strong><small>{user.email}</small>
        <button className="text-button" onClick={()=>void logout()}>退出登录</button>
      </div>
    </aside>
    <section className="chat-pane">
      <header><div>
        <h2>{current?.name||'请选择项目'}</h2>
        <small>{current?'项目聊天室 · '+(current.ai_enabled?'AI 已启用':'AI 未启用'):'创建项目后开始协作'}</small>
      </div><div className="user-avatar">{user.display_name.slice(0,1)}</div></header>
      {selected?<><div className="messages">
        {messages.length===0&&<div className="empty">发送一条消息，开始讨论工作、任务与风险。</div>}
        {messages.map(m=><article key={m.id} className={'bubble '+(m.kind==='ai'?'ai':'')}>
          <div className="msg-header"><strong>{m.kind==='ai'?'✳ AI 项目经理':m.author||'项目成员'}</strong>
            <time>{new Date(m.created_at).toLocaleString('zh-CN')}</time></div>
          <p>{m.content}</p>
        </article>)}
        <div ref={bottom}/>
      </div><form className="composer" onSubmit={send}>
        <textarea rows={3} placeholder="讨论进度、风险和待办事项…" value={chat}
          onChange={e=>setChat(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(e as unknown as FormEvent);}}}/>
        <button disabled={working||!chat.trim()}>发送</button>
      </form></>:<div className="empty">尚无项目，请从左侧创建。</div>}
    </section>
    <aside className="details">
      <div className="tabs">
        {(['tasks','proposals','reports','settings'] as const).map(t=>
          <button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>
            {({tasks:'任务',proposals:'AI 待确认',reports:'汇报',settings:'设置'})[t]}
          </button>)}
      </div>
      {!selected?<div className="empty">暂无项目内容</div>:<div className="detail-content">
        {tab==='tasks'&&<>
          <h3>任务列表 <span className="count">{tasks.length}</span></h3>
          {current?.role==='owner'&&<form className="row-form" onSubmit={createTask}>
            <input placeholder="手动创建任务" required value={newTask}
              onChange={e=>setNewTask(e.target.value)}/>
            <button disabled={working}>新增</button>
          </form>}
          {tasks.map(t=><article className="item" key={t.id}>
            <strong>{t.title}</strong><small>负责人：{t.assignee||'待指定'}</small>
            <div className="between"><small>{t.due_at?new Date(t.due_at).toLocaleDateString('zh-CN'):'无截止日期'}</small>
              <select aria-label={'任务状态：'+t.title} value={t.status}
                onChange={e=>void changeStatus(t,e.target.value)}>
                <option value="todo">待开始</option><option value="doing">进行中</option>
                <option value="blocked">阻塞</option><option value="done">已完成</option>
                <option value="cancelled">已取消</option>
              </select></div>
          </article>)}
          {!tasks.length&&<p className="hint">尚无正式任务。AI 提取的事项需要确认后才会出现。</p>}
          <h3>当前风险 <span className="count">{risks.length}</span></h3>
          {risks.map(r=><article className="item" key={r.id}><strong>{r.title}</strong>
            <small>{r.status==='open'?'未解决':'已解决'}</small></article>)}
        </>}
        {tab==='proposals'&&<>
          <h3>AI 提取的候选事项</h3>
          <p className="hint">候选不是已承诺任务；必须由项目负责人确认后才会写入正式状态。</p>
          {proposals.filter(p=>p.status==='pending').map(p=><article className="item" key={p.id}>
            <small className="pill">{p.kind==='task'?'候选任务':'候选风险'}</small>
            <h4>{p.title}</h4><p>{p.detail}</p>
            <small>{p.assignee_hint||'负责人待确认'} · {p.due_at||'时间待确认'}</small>
            {current?.role==='owner'&&<div className="actions">
              <button onClick={()=>void decision(p,true)} disabled={working}>确认</button>
              <button className="secondary" onClick={()=>void decision(p,false)} disabled={working}>忽略</button>
            </div>}
          </article>)}
          {!proposals.some(p=>p.status==='pending')&&<p className="hint">暂无待确认事项。启用 AI 后，成员发送的消息会被异步分析。</p>}
        </>}
        {tab==='reports'&&<>
          <h3>项目报告</h3><p className="hint">根据当前任务状态生成可审阅草稿，不会虚构历史进展。</p>
          {current?.role==='owner'&&<div className="actions">
            <button onClick={()=>void makeReport('week')} disabled={working}>生成周报</button>
            <button className="secondary" onClick={()=>void makeReport('month')} disabled={working}>生成月报</button>
          </div>}
          {reports.map(r=><details className="item" key={r.id}>
            <summary><strong>{r.kind==='week'?'周报':'月报'} · {r.period_key}</strong>
              <small>{r.state==='draft'?'草稿':'已发布'}</small></summary>
            <pre>{r.content}</pre>
            {r.state==='draft'&&current?.role==='owner'&&
              <button onClick={()=>void publish(r)} disabled={working}>审核并发布</button>}
          </details>)}
          {!reports.length&&<p className="hint">暂无报告。</p>}
        </>}
        {tab==='settings'&&<>
          <h3>项目成员</h3>
          {members.map(m=><div key={m.id} className="member"><strong>{m.display_name}</strong>
            <small>{m.email} · {m.role}</small><small>ID: {m.id}</small></div>)}
          {current?.role==='owner'&&<>
            <form className="row-form" onSubmit={inviteMember}>
              <input type="email" placeholder="邀请已注册成员的邮箱" value={invite} required
                onChange={e=>setInvite(e.target.value)}/>
              <button disabled={working}>加入</button>
            </form>
            <h3>AI 与提醒</h3>
            <label className="check"><input type="checkbox" checked={settings.aiEnabled}
              onChange={e=>setSettings({...settings,aiEnabled:e.target.checked})}/>
              启用外部 AI 分析（需服务端配置模型凭证）</label>
            <p className="hint">默认关闭；开启后项目成员消息可能发送至配置的模型服务。</p>
            <div className="triple">
              {(['workStart','workEnd','cooldownHours'] as const).map((key,i)=>
                <label key={key}>{['开始小时','结束小时','冷却小时'][i]}
                  <input type="number" value={settings[key]??''}
                    onChange={e=>setSettings({...settings,[key]:e.target.value===''?null:Number(e.target.value)})}/>
                </label>)}
            </div>
            <p className="hint">请完整填写时间策略才会启动自动催办。周末静默，时间以项目时区计。</p>
            <button onClick={()=>void saveSettings()} disabled={working}>保存设置</button>
          </>}
        </>}
      </div>}
      {notice&&<div role="alert" className="notice">{notice}</div>}
    </aside>
  </main>;
}
