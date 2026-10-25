'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {request,type Tenant,type Project} from '../components/client';

type Bot={id:string;botId:string;tenantId:string};
type Listing={bots:Bot[]};
type Instruction={command:string;expiresInSeconds:number};

export default function ImSettings(){
  const [tenants,setTenants]=useState<Tenant[]>([]);
  const [projects,setProjects]=useState<Project[]>([]);
  const [bots,setBots]=useState<Bot[]>([]);
  const [tenant,setTenant]=useState('');
  const [bot,setBot]=useState('');
  const [project,setProject]=useState('');
  const [botId,setBotId]=useState('');
  const [secret,setSecret]=useState('');
  const [instruction,setInstruction]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [ready,setReady]=useState(false);
  const load=useCallback(async()=>{
    const [t,p,b]=await Promise.all([
      request<{tenants:Tenant[]}>('/tenants'),
      request<{projects:Project[]}>('/projects'),
      request<Listing>('/im/bots'),
    ]);
    setTenants(t.tenants);setProjects(p.projects);setBots(b.bots);
    setTenant(current=>t.tenants.some(x=>x.id===current&&x.role==='admin')?current:
      t.tenants.find(x=>x.role==='admin')?.id??'');
    setBot(current=>b.bots.some(x=>x.id===current)?current:b.bots[0]?.id??'');
    setProject(current=>p.projects.some(x=>x.id===current&&x.role==='owner')?current:
      p.projects.find(x=>x.role==='owner')?.id??'');
    setReady(true);
  },[]);
  useEffect(()=>{void load().catch(e=>setNotice(e instanceof Error?e.message:'加载失败'));},[load]);
  async function run<T>(action:()=>Promise<T>,onSuccess:(r:T)=>void|Promise<void>){
    setBusy(true);setNotice('');
    try{const result=await action();await onSuccess(result);}
    catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setBusy(false);}
  }
  async function register(e:FormEvent){
    e.preventDefault();
    if(!tenant)return;
    await run(()=>request<{id:string;botId:string}>(`/tenants/${tenant}/im/bots`,{
      method:'POST',body:JSON.stringify({botId,secret,idempotencyKey:crypto.randomUUID()}),
    }),async()=>{setSecret('');setBotId('');await load();setNotice('机器人配置已保存。');});
  }
  const selectedBot=bots.find(x=>x.id===bot);
  const owned=projects.filter(x=>x.role==='owner');
  return <main style={{maxWidth:900,margin:'0 auto',padding:'28px 18px',display:'grid',gap:18}}>
    <a href="/" style={{color:'#2563eb'}}>返回 ChatPM 项目工作台</a>
    <h1>IM 集成（实验性）</h1>
    <p className="hint">目前只支持企业微信智能机器人长连接的文本交互。尚无实机验收；请勿使用敏感项目或生产凭据。普通群消息的完整监听、历史和附件暂不支持。</p>
    {!ready&&<p role="status">正在检查登录和账号权限…</p>}
    {tenants.some(x=>x.role==='admin')&&<section className="item stack">
      <h2>组织管理员 · 注册企业微信机器人</h2>
      <form onSubmit={e=>void register(e)} className="stack">
        <label>所属组织<select value={tenant} onChange={e=>setTenant(e.target.value)}>
          {tenants.filter(t=>t.role==='admin').map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        <label>机器人 ID<input required maxLength={200} value={botId} onChange={e=>setBotId(e.target.value)} autoComplete="off"/></label>
        <label>机器人 Secret<input required type="password" minLength={16} value={secret} onChange={e=>setSecret(e.target.value)} autoComplete="new-password"/></label>
        <button disabled={busy||!tenant}>登记机器人</button>
      </form>
    </section>}
    <section className="item stack">
      <h2>成员绑定 · 证明你的企业微信身份</h2>
      <label>已接入的机器人<select value={bot} onChange={e=>{setBot(e.target.value);setInstruction('');}}>
        <option value="">选择机器人</option>{bots.map(b=><option key={b.id} value={b.id}>{b.botId}</option>)}
      </select></label>
      <button disabled={busy||!selectedBot} onClick={()=>void run(
        ()=>request<Instruction>(`/im/bots/${bot}/bind-me`,{method:'POST'}),
        r=>{setInstruction(r.command);setNotice('请在十分钟内将下方口令发到机器人私聊。');}
      )}>生成私聊身份绑定口令</button>
      {selectedBot&&tenants.some(x=>x.id===selectedBot.tenantId&&x.role==='admin')&&
        <button disabled={busy} onClick={()=>void run(
          ()=>request(`/tenants/${selectedBot.tenantId}/im/bots/${bot}/disable`,{
            method:'POST',body:JSON.stringify({idempotencyKey:crypto.randomUUID()}),
          }),async()=>{await load();setNotice('机器人已停用。');}
        )}>停用选中机器人</button>}
    </section>
    {owned.length>0&&<section className="item stack">
      <h2>项目负责人 · 将机器人绑定到项目群</h2>
      <label>项目<select value={project} onChange={e=>{setProject(e.target.value);setInstruction('');}}>
        {owned.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <p className="hint">必须先完成上方个人身份绑定；在目标企业微信群里使用同一企微账号 @机器人并发送生成的 /link 口令。群成员应当已被允许查看项目资料。</p>
      <div className="row-form">
        <button disabled={busy||!project||!bot} onClick={()=>void run(
          ()=>request<Instruction>(`/projects/${project}/im/bots/${bot}/link`,{method:'POST'}),
          r=>{setInstruction(r.command);setNotice('在十分钟内由项目负责人本人发送群绑定口令。');}
        )}>生成群绑定口令</button>
        <button disabled={busy||!project||!bot} onClick={()=>void run(
          ()=>request(`/projects/${project}/im/bots/${bot}/link`,{method:'DELETE'}),
          ()=>{setInstruction('');setNotice('已撤销该项目群绑定。');}
        )}>撤销群绑定</button>
      </div>
    </section>}
    {instruction&&<section className="item stack">
      <h2>一次性口令</h2>
      <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-all'}}>{instruction}</pre>
      <button onClick={()=>void navigator.clipboard.writeText(instruction)}>复制口令</button>
    </section>}
    {notice&&<p role="status" className="notice">{notice}</p>}
  </main>;
}
