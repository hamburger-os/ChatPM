'use client';
import { useCallback,useEffect,useRef,useState,type FormEvent } from 'react';
import WorkspaceDetails from './components/WorkspaceDetails';
import AdminModelPanel from './components/AdminModelPanel';
import OrganizationPanel from './components/OrganizationPanel';
import type { Message,Project,Tenant,User } from './components/client';
import { json,request } from './components/client';

type View='projects'|'organization'|'system'|'account';
function RailIcon({view}:{view:View}){
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {view==='projects'&&<><path d="M4 4h16v12H7l-3 4V4Z"/><path d="M8 9h8M8 12h5"/></>}
    {view==='organization'&&<><circle cx="9" cy="7" r="3"/><path d="M2.5 20v-2a6.5 6.5 0 0 1 13 0v2H2.5ZM17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3.5 5"/></>}
    {view==='system'&&<><path d="M12 2.5l2.2 2.1 3-.3.8 3 2.5 1.7-1.1 2.8 1.1 2.8-2.5 1.7-.8 3-3-.3-2.2 2.1-2.2-2.1-3 .3-.8-3-2.5-1.7 1.1-2.8-1.1-2.8 2.5-1.7.8-3 3 .3L12 2.5Z"/><circle cx="12" cy="12" r="3.2"/></>}
    {view==='account'&&<><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2H4Z"/></>}
  </svg>;
}
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
  const [search,setSearch]=useState('');
  const [view,setView]=useState<View>('projects');
  const [showDetails,setShowDetails]=useState(true);
  const [mobileWork,setMobileWork]=useState(false);
  const [messages,setMessages]=useState<Message[]>([]);
  const [chat,setChat]=useState('');
  const [working,setWorking]=useState(false);
  const [notice,setNotice]=useState('');
  const bottom=useRef<HTMLDivElement>(null);
  const cursor=useRef(0);
  const current=projects.find(x=>x.id===selected)||null;
  const canOrg=tenants.some(x=>x.role==='admin');

  const loadProjects=useCallback(async()=>{
    const x=await request<{projects:Project[]}>('/projects');
    setProjects(x.projects);
    setSelected(id=>{
      const query=typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('project');
      return (id&&x.projects.some(p=>p.id===id)?id:null)||
        (query&&x.projects.some(p=>p.id===query)?query:null)||
        x.projects[0]?.id||null;
    });
  },[]);
  const loadTenants=useCallback(async()=>{
    const x=await request<{tenants:Tenant[]}>('/tenants');
    setTenants(x.tenants);
    setTenantId(id=>x.tenants.some(t=>t.id===id&&t.role==='admin')?id:
      x.tenants.find(t=>t.role==='admin')?.id||'');
  },[]);
  useEffect(()=>{
    let active=true;setAuth('checking');
    void request<{user:User}>('/me').then(async x=>{
      if(!active)return;
      setUser(x.user);setAuth('ready');
      const initial=new URLSearchParams(window.location.search).get('view');
      if(initial==='system'&&x.user.is_system_admin)setView('system');
      else if(initial==='account')setView('account');
      await Promise.all([loadProjects(),loadTenants()]).catch(e=>{
        if(active)setNotice(e instanceof Error?e.message:'工作区暂时无法加载');
      });
    }).catch(e=>{
      if(!active)return;
      setUser(null);setAuth((e as {status?:number}).status===401?'anonymous':'error');
    });
    return ()=>{active=false;};
  },[retry,loadProjects,loadTenants]);
  useEffect(()=>{
    if(!selected||view!=='projects')return;
    let active=true;cursor.current=0;setMessages([]);
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
    let inFlight=false;
    const poll=async()=>{
      if(!active||document.hidden||inFlight)return;
      inFlight=true;
      try{await update();}catch(e){if(active)setNotice(e instanceof Error?e.message:'消息刷新失败');}
      finally{inFlight=false;}
    };
    void poll();
    const timer=setInterval(()=>void poll(),5000);
    const visible=()=>{if(!document.hidden)void poll();};
    document.addEventListener('visibilitychange',visible);
    return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[selected,view]);
  useEffect(()=>{if(view==='projects')bottom.current?.scrollIntoView({behavior:'smooth'});},[messages.length,view]);
  async function action(fn:()=>Promise<void>){
    setNotice('');setWorking(true);
    try{await fn();}catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setWorking(false);}
  }
  function navigate(next:View){
    setView(next);setNotice('');
    const params=new URLSearchParams(window.location.search);
    if(next==='projects')params.delete('view');else params.set('view',next);
    if(selected)params.set('project',selected);
    window.history.replaceState(null,'',window.location.pathname+(params.size?'?'+params:''));
  }
  function selectProject(id:string){
    setMobileWork(false);setSelected(id);setNotice('');
    const params=new URLSearchParams(window.location.search);
    params.set('project',id);params.delete('view');
    window.history.replaceState(null,'',window.location.pathname+'?'+params);
    setView('projects');
  }
  function login(e:FormEvent){
    e.preventDefault();void action(async()=>{
      await request('/auth/'+(register?'register':'login'),{method:'POST',body:json({email,password,displayName})});
      const x=await request<{user:User}>('/me');
      setUser(x.user);setAuth('ready');setPassword('');
      await Promise.all([loadProjects(),loadTenants()]);
    });
  }
  function createProject(e:FormEvent){
    e.preventDefault();if(!tenantId)return;
    void action(async()=>{
      const x=await request<{project:Project}>('/projects',{method:'POST',
        body:json({name:newProject,tenantId,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai'})});
      setNewProject('');await loadProjects();selectProject(x.project.id);
    });
  }
  function send(e:FormEvent){
    e.preventDefault();if(!selected||!chat.trim()||current?.role==='observer')return;
    const content=chat.trim();
    void action(async()=>{
      await request('/projects/'+selected+'/messages',{method:'POST',
        body:json({content,nonce:crypto.randomUUID()})});
      setChat('');
    });
  }
  function logout(){
    void action(async()=>{
      await request('/auth/logout',{method:'POST'});
      setUser(null);setAuth('anonymous');setProjects([]);setTenants([]);
      setSelected(null);setView('projects');
    });
  }

  if(auth==='checking')return <main className="auth-shell">
    <section className="auth-card"><div className="brand"><img className="brand-mark" src="/icon.svg" alt="" width={32} height={32}/>ChatPM</div><p>正在检查登录会话…</p></section></main>;
  if(auth==='error')return <main className="auth-shell">
    <section className="auth-card"><div className="brand"><img className="brand-mark" src="/icon.svg" alt="" width={32} height={32}/>ChatPM</div>
      <h2>服务暂时不可用</h2><p>网络异常不会清除已有登录会话。</p>
      <button onClick={()=>setRetry(x=>x+1)}>重试连接</button></section></main>;
  if(!user)return <main className="auth-shell"><section className="auth-card">
      <div className="brand"><img className="brand-mark" src="/icon.svg" alt="" width={32} height={32}/>ChatPM</div>
      <h1>让项目主动向前</h1><p>用自然协作推动项目，让 AI 协助跟进任务与风险。</p>
      <form className="stack" onSubmit={login}>
        {register&&<label>昵称<input required value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>}
        <label>邮箱<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>密码<input type="password" autoComplete={register?'new-password':'current-password'} required minLength={register?10:1}
          value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <button disabled={working}>{register?'注册并创建组织':'登录'}</button>
      </form><button className="text-button" onClick={()=>setRegister(!register)}>
        {register?'已有账号？登录':'没有账号？创建组织'}
      </button>
      <details className="login-help"><summary>系统管理员如何登录？</summary>
        <p>系统管理员使用同一邮箱和密码登录。首次部署时须由服务器操作员先为已注册账号授权；登录后在最左侧进入「系统管理」。组织管理员或项目负责人不自动具有系统管理权限。</p>
      </details>
      {notice&&<p role="alert" className="notice">{notice}</p>}
    </section></main>;

  return <main className={'app-shell '+(view==='projects'&&showDetails?'has-details':'without-details')+(mobileWork?' mobile-work':' mobile-chat')}>
    <nav className="app-rail" aria-label="主功能导航">
      <div className="rail-logo" aria-label="ChatPM"><img src="/icon.svg" alt="" width={42} height={42}/></div>
      {(['projects',...(canOrg?['organization' as const]:[]),
        ...(user.is_system_admin?['system' as const]:[])] as View[]).map(item=>
        <button className={'rail-action '+(view===item?'active':'')} key={item}
          title={{projects:'项目协作',organization:'组织管理',system:'系统管理',account:'个人设置'}[item]}
          aria-label={{projects:'项目协作',organization:'组织管理',system:'系统管理',account:'个人设置'}[item]}
          aria-current={view===item?'page':undefined} onClick={()=>navigate(item)}>
          <RailIcon view={item}/><span className="rail-label">
            {{projects:'项目',organization:'组织',system:'系统',account:'我的'}[item]}</span>
        </button>)}
      <button className={'rail-action rail-account '+(view==='account'?'active':'')}
        title="个人设置" aria-label="个人设置" aria-current={view==='account'?'page':undefined}
        onClick={()=>navigate('account')}><RailIcon view="account"/><span className="rail-label">我的</span></button>
    </nav>
    <aside className="app-sidebar" aria-label="当前功能导航">
      <div className="app-sidebar-title"><span className="brand">ChatPM</span>
        <small>{view==='projects'?'项目协作':view==='organization'?'组织管理':
          view==='system'?'系统管理':'个人设置'}</small></div>
      {view==='projects'&&<>
        <div className="sidebar-search"><input aria-label="搜索项目" placeholder="搜索项目…"
          value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <p className="section-label">我的项目 <span>{projects.length}</span></p>
        <nav className="project-menu">{projects.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())).map(p=>
          <button key={p.id} className={'project '+(p.id===selected?'selected':'')}
            onClick={()=>selectProject(p.id)}><span className="project-symbol">◈</span>
              <span>{p.name}</span></button>)}</nav>
        {canOrg&&<form className="stack new-project" onSubmit={createProject}>
          <p className="section-label">新建项目</p>
          <label>所属组织<select value={tenantId} onChange={e=>setTenantId(e.target.value)}>
            {tenants.filter(t=>t.role==='admin').map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
          <input required placeholder="输入项目名称" value={newProject} onChange={e=>setNewProject(e.target.value)}/>
          <button disabled={working||!tenantId}>＋ 新项目</button>
        </form>}
      </>}
      {view==='organization'&&<div className="sidebar-menu">
        <p className="section-label">管理组织</p>
        {tenants.filter(t=>t.role==='admin').map(t=><button key={t.id}
          className={'project '+(tenantId===t.id?'selected':'')}
          onClick={()=>setTenantId(t.id)}><span className="project-symbol">▦</span>{t.name}</button>)}
      </div>}
      {view==='system'&&<div className="sidebar-menu">
        <p className="section-label">管理入口</p>
        <div className="project selected"><span className="project-symbol">✳</span>AI 服务中心</div>
        <p className="hint">仅系统管理员可维护供应商连接、模型和密钥。</p>
      </div>}
      {view==='account'&&<div className="sidebar-menu">
        <p className="section-label">账户</p><div className="project selected">{user.display_name}</div>
      </div>}
      <div className="sidebar-footer">
        <strong>{user.display_name}</strong><small>{user.email}</small>
        {user.is_system_admin&&<small>系统管理员</small>}
        <button className="text-button" onClick={()=>navigate('account')}>账户与退出</button>
      </div>
    </aside>
    {view==='projects'?<>
      <nav className="mobile-project-tabs" aria-label="移动端项目工作区">
        <button type="button" aria-pressed={!mobileWork} className={!mobileWork?'active':''}
          onClick={()=>setMobileWork(false)}>消息</button>
        <button type="button" aria-pressed={mobileWork} className={mobileWork?'active':''}
          disabled={!selected} onClick={()=>{setMobileWork(true);setShowDetails(true);}}>任务与工作台</button>
      </nav>
      <section className="chat-pane">
        <header><div><h2>{current?.name||'请选择项目'}</h2>
          <small>{current?(current.ai_enabled?'AI 消息分析已开启':'AI 消息分析未开启'):'选择一个项目开始协作'}</small></div>
          <button type="button" className="pane-toggle" aria-label={showDetails?'收起项目工作面板':'展开项目工作面板'}
            title={showDetails?'收起项目工作面板':'展开项目工作面板'}
            onClick={()=>setShowDetails(x=>!x)}>{showDetails?'收起详情 ◧':'展开详情 ◨'}</button>
        </header>
        {selected?<><div className="messages">
          {messages.map(m=><article key={m.id} className={'bubble '+(m.kind==='ai'?'ai':'')}>
            <div className="msg-header"><strong>{m.kind==='ai'?'✳ AI 项目经理':m.author||'项目成员'}</strong>
              <time>{new Date(m.created_at).toLocaleString('zh-CN')}</time></div>
            <p>{m.content}</p></article>)}
          {!messages.length&&<div className="empty">开始讨论任务、进度、问题与风险。</div>}<div ref={bottom}/>
        </div>{current?.role!=='observer'&&<form className="composer" onSubmit={send}>
          <textarea rows={3} placeholder="讨论项目进度；输入 @AI 与 AI 协作"
            value={chat} onChange={e=>setChat(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){
              e.preventDefault();send(e as unknown as FormEvent);}}}/>
          <button disabled={working||!chat.trim()}>发送</button>
        </form>}</>:<div className="empty">尚无项目，请从左侧创建或加入。</div>}
      </section>
      {showDetails&&<WorkspaceDetails key={selected||'empty'} project={current} user={user}/>}
    </>:<section className="workspace-main" aria-label="管理工作区">
      {view==='organization'&&tenantId&&<OrganizationPanel tenantId={tenantId}/>}
      {view==='organization'&&!tenantId&&<div className="empty">你尚未管理任何组织。</div>}
      {view==='system'&&user.is_system_admin&&<AdminModelPanel/>}
      {view==='account'&&<section className="account-settings">
        <h2>个人设置</h2>
        <div className="profile-card"><div className="user-avatar">{user.display_name.slice(0,1)}</div>
          <div><strong>{user.display_name}</strong><p className="hint">{user.email}</p></div></div>
        <h3>账户权限</h3>
        <p>{user.is_system_admin?'系统管理员':'普通用户'} · 组织角色与项目角色由各组织及项目负责人管理。</p>
        <p className="hint">系统管理员与普通用户使用同一登录入口；只有经过服务器受控授权的用户可以打开系统管理页面。</p>
        <button type="button" className="secondary" onClick={logout} disabled={working}>退出登录</button>
      </section>}
    </section>}
    {notice&&<div role="alert" className="global-notice">{notice}
      <button type="button" aria-label="关闭提示" onClick={()=>setNotice('')}>×</button></div>}
  </main>;
}
