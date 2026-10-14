'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import WorkspaceDetails from './components/WorkspaceDetails';
import type { Message, Project, Tenant, User } from './components/client';
import { json,request } from './components/client';

export default function Home(){
  const [user,setUser]=useState<User|null>(null);
  const [auth,setAuth]=useState<'checking'|'ready'|'anonymous'|'error'>('checking');
  const [retry,setRetry]=useState(0);
  const [register,setRegister]=useState(false);
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[displayName,setDisplayName]=useState('');
  const [projects,setProjects]=useState<Project[]>([]);
  const [tenants,setTenants]=useState<Tenant[]>([]);
  const [tenantId,setTenantId]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [newProject,setNewProject]=useState('');
  const [messages,setMessages]=useState<Message[]>([]);
  const [chat,setChat]=useState('');
  const [working,setWorking]=useState(false);
  const [notice,setNotice]=useState('');
  const bottom=useRef<HTMLDivElement>(null);
  const cursor=useRef(0);
  const current=projects.find(x=>x.id===selected)||null;
  const loadProjects=useCallback(async()=>{
    const x=await request<{projects:Project[]}>('/projects');
    setProjects(x.projects);
    setSelected(id=>id&&x.projects.some(p=>p.id===id)?id:x.projects[0]?.id||null);
  },[]);
  const loadTenants=useCallback(async()=>{
    const x=await request<{tenants:Tenant[]}>('/tenants');
    setTenants(x.tenants);
    setTenantId(id=>x.tenants.some(t=>t.id===id&&t.role==='admin')?id:
      x.tenants.find(t=>t.role==='admin')?.id||'');
  },[]);
  useEffect(()=>{
    let active=true;
    setAuth('checking');
    void request<{user:User}>('/me').then(async x=>{
      if(!active)return;
      setUser(x.user);setAuth('ready');
      // A failure to fetch business data must never invalidate a valid session.
      await Promise.all([loadProjects(),loadTenants()]).catch(e=>{
        if(active)setNotice(e instanceof Error?e.message:'项目数据暂时无法加载');
      });
    }).catch(e=>{
      if(!active)return;
      setUser(null);setAuth((e as {status?:number}).status===401?'anonymous':'error');
    });
    return ()=>{active=false;};
  },[retry,loadProjects,loadTenants]);
  useEffect(()=>{
    if(!selected)return;
    let active=true;
    cursor.current=0;setMessages([]);
    async function update(){
      const x=await request<{messages:Message[]}>('/projects/'+selected+'/messages?after='+cursor.current);
      if(!active)return;
      if(x.messages.length){
        cursor.current=Math.max(cursor.current,...x.messages.map(m=>Number(m.seq)));
        setMessages(old=>{
          const known=new Set(old.map(m=>m.id));
          return [...old,...x.messages.filter(m=>!known.has(m.id))].slice(-1500);
        });
      }
    }
    void update().catch(e=>setNotice(e.message));
    const timer=setInterval(()=>void update().catch(e=>setNotice(e.message)),5000);
    return ()=>{active=false;clearInterval(timer);};
  },[selected]);
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[messages.length]);
  async function action(fn:()=>Promise<void>){
    setNotice('');setWorking(true);
    try{await fn();}
    catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setWorking(false);}
  }
  function login(e:FormEvent){
    e.preventDefault();
    void action(async()=>{
      await request('/auth/'+(register?'register':'login'),{method:'POST',
        body:json({email,password,displayName})});
      const x=await request<{user:User}>('/me');
      setUser(x.user);setAuth('ready');setPassword('');
      await Promise.all([loadProjects(),loadTenants()]);
    });
  }
  function createProject(e:FormEvent){
    e.preventDefault();if(!tenantId)return;
    void action(async()=>{
      const x=await request<{project:Project}>('/projects',{method:'POST',
        body:json({name:newProject,tenantId,timezone:'Asia/Shanghai'})});
      setNewProject('');await loadProjects();setSelected(x.project.id);
    });
  }
  function send(e:FormEvent){
    e.preventDefault();
    if(!selected||!chat.trim()||current?.role==='observer')return;
    const content=chat.trim();
    void action(async()=>{
      await request('/projects/'+selected+'/messages',{method:'POST',
        body:json({content,nonce:crypto.randomUUID()})});
      setChat('');
      // Incremental polling remains the source of message order.
    });
  }
  function logout(){
    void action(async()=>{
      await request('/auth/logout',{method:'POST'});
      setUser(null);setAuth('anonymous');setProjects([]);setTenants([]);setSelected(null);
    });
  }
  if(auth==='checking')return <main className="auth-shell">
    <section className="auth-card"><div className="brand">✳ ChatPM</div><p>正在检查登录会话…</p></section>
  </main>;
  if(auth==='error')return <main className="auth-shell">
    <section className="auth-card"><div className="brand">✳ ChatPM</div>
      <h2>服务暂时不可用</h2><p>网络异常不会清除已有登录会话。</p>
      <button onClick={()=>setRetry(x=>x+1)}>重试连接</button></section>
  </main>;
  if(!user)return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand"><span className="brand-icon">✳</span> ChatPM</div>
      <h1>让项目主动向前</h1>
      <p>项目协作、AI 候选确认、任务跟进与组织治理。</p>
      <form className="stack" onSubmit={login}>
        {register&&<label>昵称<input required value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>}
        <label>邮箱<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>密码<input type="password" autoComplete={register?'new-password':'current-password'}
          required minLength={register?10:1} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <button disabled={working}>{register?'注册并创建团队':'登录'}</button>
      </form>
      <button className="text-button" onClick={()=>setRegister(!register)}>
        {register?'已有账号？登录':'没有账号？创建新团队'}
      </button>
      {notice&&<p role="alert" className="notice">{notice}</p>}
    </section>
  </main>;
  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">✳</span> ChatPM</div>
      <p className="section-label">我的项目</p>
      <nav>{projects.map(p=><button key={p.id} onClick={()=>setSelected(p.id)}
        className={'project '+(p.id===selected?'selected':'')}>◉ {p.name}</button>)}</nav>
      {tenants.some(t=>t.role==='admin')&&<form className="stack new-project" onSubmit={createProject}>
        <label>所属组织<select value={tenantId} onChange={e=>setTenantId(e.target.value)}>
          {tenants.filter(t=>t.role==='admin').map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        <label>创建项目<input required placeholder="项目名称" value={newProject}
          onChange={e=>setNewProject(e.target.value)}/></label>
        <button disabled={working||!tenantId}>＋ 新项目</button>
      </form>}
      <div className="sidebar-footer"><strong>{user.display_name}</strong>
        <small>{user.email}</small>
        <button className="text-button" onClick={logout}>退出登录</button></div>
    </aside>
    <section className="chat-pane">
      <header><div><h2>{current?.name||'请选择项目'}</h2>
        <small>{current?(current.ai_enabled?'AI 消息分析已开启':'AI 消息分析未开启'):'选择项目开始协作'}</small>
      </div><div className="user-avatar">{user.display_name.slice(0,1)}</div></header>
      {selected?<><div className="messages">
        {messages.map(m=><article key={m.id} className={'bubble '+(m.kind==='ai'?'ai':'')}>
          <div className="msg-header"><strong>{m.kind==='ai'?'✳ AI 项目经理':m.author||'项目成员'}</strong>
            <time>{new Date(m.created_at).toLocaleString('zh-CN')}</time></div>
          <p>{m.content}</p></article>)}
        {!messages.length&&<div className="empty">开始讨论工作、进度、问题与风险。</div>}
        <div ref={bottom}/>
      </div>{current?.role!=='observer'&&<form className="composer" onSubmit={send}>
        <textarea rows={3} placeholder="讨论进度、风险与任务；输入 @AI 与 AI 协作"
          value={chat} onChange={e=>setChat(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){
            e.preventDefault();send(e as unknown as FormEvent);}}}/>
        <button disabled={working||!chat.trim()}>发送</button>
      </form>}</>:<div className="empty">尚无项目，请从左侧创建或加入。</div>}
    </section>
    <WorkspaceDetails key={selected||'empty'} project={current} tenantId={tenantId} user={user}/>
    {notice&&<div role="alert" className="notice">{notice}</div>}
  </main>;
}
