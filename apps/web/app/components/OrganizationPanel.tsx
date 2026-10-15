'use client';
import { useEffect,useRef,useState,type FormEvent } from 'react';
type Item={id:string;name:string;description?:string;parent_id?:string|null;portfolio_id?:string|null};
type Project=Item&{department_id:string|null;program_id:string|null;
  portfolio_id:string|null;classification_revision:number;
  participating_department_ids:string[]};
type Member={id:string;display_name:string;email:string;role:'admin'|'member'};
type Invitation={id:string;email:string;created_at:string;expires_at:string;
  accepted_at:string|null;revoked_at:string|null};
type Allocation={id:string;project_id:string;user_id:string;percentage:number;start_date:string;end_date:string;cancelled_at:string|null;cancelled_by:string|null};
type Structure={departments:Item[];portfolios:Item[];programs:Item[];projects:Project[]};
const empty:Structure={departments:[],portfolios:[],programs:[],projects:[]};
async function api<T>(path:string,options?:RequestInit):Promise<T>{
  const response=await fetch('/api'+path,{...options,credentials:'include',cache:'no-store',
    headers:{'Content-Type':'application/json',...options?.headers}});
  const data=await response.json().catch(()=>({error:'暂时无法访问服务'}));
  if(!response.ok)throw new Error(data.error||'操作失败');
  return data as T;
}
export default function OrganizationPanel({tenantId,currentUserId}:{tenantId:string;currentUserId:string}){
  const [data,setData]=useState<Structure>(empty);
  const [members,setMembers]=useState<Member[]>([]);
  const [invitations,setInvitations]=useState<Invitation[]>([]);
  const [inviteEmail,setInviteEmail]=useState('');
  const [inviteCode,setInviteCode]=useState('');
  const [allocations,setAllocations]=useState<Allocation[]>([]);
  const [kind,setKind]=useState<'departments'|'portfolios'|'programs'>('departments');
  const [tab,setTab]=useState<'people'|'structure'|'resources'>('people');
  const [name,setName]=useState('');
  const [portfolio,setPortfolio]=useState('');
  const [projectId,setProjectId]=useState('');
  const [departmentId,setDepartmentId]=useState('');
  const [participatingDepartmentIds,setParticipatingDepartmentIds]=useState<string[]>([]);
  const [programId,setProgramId]=useState('');
  const [directPortfolio,setDirectPortfolio]=useState('');
  const [email,setEmail]=useState('');
  const [assignee,setAssignee]=useState('');
  const [percentage,setPercentage]=useState(50);
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const commandKeys=useRef(new Map<string,string>());
  const base='/tenants/'+tenantId;
  async function write<T>(path:string,method:'POST'|'PATCH',
    body:Record<string,unknown>):Promise<T>{
    const intent=JSON.stringify([tenantId,path,method,body]);
    const idempotencyKey=commandKeys.current.get(intent)??crypto.randomUUID();
    commandKeys.current.set(intent,idempotencyKey);
    const result=await api<T>(path,{method,
      body:JSON.stringify({...body,idempotencyKey})});
    commandKeys.current.delete(intent);
    return result;
  }
  async function reload(){
    const [s,m,a,i]=await Promise.all([
      api<Structure>(base+'/structure'),
      api<{members:Member[]}>(base+'/members'),
      api<{allocations:Allocation[]}>(base+'/allocations'),
      api<{invitations:Invitation[]}>(base+'/invitations')]);
    setData(s);setMembers(m.members);setAllocations(a.allocations);
    setInvitations(i.invitations);
  }
  useEffect(()=>{void reload().catch(e=>setNotice(e.message));},[tenantId]);
  async function run(fn:()=>Promise<void|boolean>){
    setBusy(true);setNotice('');
    try{
      const shouldReload=await fn();
      if(shouldReload!==false)await reload();
    }
    catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setBusy(false);}
  }
  const create=(e:FormEvent)=>{
    e.preventDefault();void run(async()=>{
      await write(base+'/'+kind,'POST',{
        name,...(kind==='programs'?{portfolioId:portfolio||null}:{})});
      setName('');
    });
  };
  const classification=(e:FormEvent)=>{
    e.preventDefault();void run(async()=>{
      const project=data.projects.find(p=>p.id===projectId);
      if(!project)throw new Error('请选择有效项目并刷新项目归属');
      await write(base+'/projects/'+projectId+'/classification','PATCH',{
        expectedRevision:project.classification_revision,
        departmentId:departmentId||null,programId:programId||null,
        portfolioId:programId?null:directPortfolio||null,
        participatingDepartmentIds:participatingDepartmentIds});
    });
  };
  async function refreshClassification(){
    const result=await api<Structure>(base+'/structure');
    setData(result);
    const project=result.projects.find(p=>p.id===projectId);
    setDepartmentId(project?.department_id||'');
    setParticipatingDepartmentIds(project?.participating_department_ids??[]);
    setProgramId(project?.program_id||'');
    setDirectPortfolio(project?.portfolio_id||'');
  }
  return <section className="organization-workspace">
    <header className="management-heading"><div><h2>组织管理</h2>
      <p className="hint">部门管理人员与资源；项目集协调关联项目；项目组合管理战略与投入。成员加入部门不等于获得项目聊天权限。</p>
    </div></header>
    <nav className="management-tabs" aria-label="组织管理分类">
      {(['people','structure','resources'] as const).map(t=><button key={t} type="button"
        className={tab===t?'active':''} onClick={()=>setTab(t)}>
        {({people:'组织人员',structure:'部门与项目结构',resources:'资源投入'})[t]}
      </button>)}
    </nav>
    {tab==='people'&&<div className="stack organization-section">
    <h3>组织人员（{members.length}）</h3>
    {members.map(m=><div className="member" key={m.id}>
      <strong>{m.display_name}</strong><small>{m.email}</small>
      <select aria-label={'组织角色：'+m.display_name} value={m.role} disabled={busy} onChange={e=>{
        const nextRole=e.currentTarget.value;
        const selfDemotion=m.id===currentUserId&&m.role==='admin'&&nextRole==='member';
        if(selfDemotion&&!window.confirm('确定将自己的组织管理员角色降为普通成员？需要其他组织管理员重新授权才能恢复管理权限。')){
          e.currentTarget.value=m.role;
          return;
        }
        void run(async()=>{
          await write(base+'/members/'+m.id,'PATCH',{role:nextRole});
          if(selfDemotion){
            // The commit revoked organization admin access. A privileged
            // reload here would misleadingly report 403 for a successful write.
            window.location.reload();
            return false;
          }
        });
      }}><option value="admin">组织管理员</option><option value="member">成员</option></select>
    </div>)}
    <form className="row-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
      await write(base+'/members','POST',{email});setEmail('');
    });}}>
      <input type="email" placeholder="将已注册人员加入组织" required value={email} onChange={e=>setEmail(e.target.value)}/>
      <button disabled={busy}>加入</button>
    </form>
    <h3>邀请新成员</h3>
    <p className="hint">管理员为指定邮箱签发一次性邀请码，有效期 7 天。
      请通过受信任的渠道私下交给对应人员；邀请码仅首次签发时显示。</p>
    <form className="row-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
      const issued=await write<{invitation:Invitation;code:string|null}>(
        base+'/invitations','POST',{email:inviteEmail});
      setInviteEmail('');
      setInviteCode(issued.code??'');
      if(!issued.code)throw new Error('原邀请已建立，但凭据只返回一次；如已丢失，请撤销并重新签发');
    });}}>
      <input type="email" required placeholder="受邀人员邮箱" value={inviteEmail}
        onChange={e=>setInviteEmail(e.target.value)}/>
      <button disabled={busy}>签发邀请</button>
    </form>
    {inviteCode&&<div className="item">
      <strong>一次性邀请码（离开页面后无法再次查看）</strong>
      <p className="hint">仅交给受邀邮箱本人，不要公开分享。</p>
      <input aria-label="本次签发邀请码" readOnly value={inviteCode}/>
      <button type="button" className="secondary" onClick={()=>void navigator.clipboard
        .writeText(inviteCode).then(()=>setNotice('已复制邀请码，请私下发送'))
        .catch(()=>setNotice('复制失败，请手动选择邀请码'))}>复制邀请码</button>
      <button type="button" className="secondary" onClick={()=>setInviteCode('')}>清除显示</button>
    </div>}
    {invitations.map(i=><div className="member" key={i.id}>
      <strong>{i.email}</strong>
      <small>{i.accepted_at?'已接受':i.revoked_at?'已撤销':
        new Date(i.expires_at).getTime()<Date.now()?'已过期':'待接受'}
        {' · 截止 '+new Date(i.expires_at).toLocaleString()}</small>
      {!i.accepted_at&&!i.revoked_at&&
        <button className="secondary" type="button" disabled={busy}
          onClick={()=>void run(async()=>{
            await write(base+'/invitations/'+i.id+'/revoke','POST',{});
          })}>撤销邀请码</button>}
    </div>)}
    </div>}
    {tab==='structure'&&<div className="stack organization-section">
    <h3>部门 / 项目组合 / 项目集</h3>
    {(['departments','portfolios','programs'] as const).map(k=><div key={k} className="item">
      <strong>{({departments:'部门',portfolios:'项目组合',programs:'项目集'})[k]} ({data[k].length})</strong>
      {data[k].map(x=><p key={x.id} className="hint">{x.name}
        {k==='departments'&&<small>
          {' · 主责 '+data.projects.filter(p=>p.department_id===x.id).length+' 个项目'}
          {' · 参与 '+data.projects.filter(p=>p.participating_department_ids.includes(x.id)).length+' 个项目'}
        </small>}
      </p>)}
    </div>)}
    <form className="stack" onSubmit={create}>
      <label>创建类型<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>
        <option value="departments">部门</option><option value="portfolios">项目组合</option>
        <option value="programs">项目集</option>
      </select></label>
      <label>名称<input required value={name} onChange={e=>setName(e.target.value)}/></label>
      {kind==='programs'&&<label>所属项目组合（可选）
        <select value={portfolio} onChange={e=>setPortfolio(e.target.value)}>
          <option value="">暂不归属</option>{data.portfolios.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
        </select></label>}
      <button disabled={busy}>创建</button>
    </form>
    <h3>项目结构归属</h3>
    <form className="stack" onSubmit={classification}>
      <label>项目<select value={projectId} onChange={e=>{
        const p=data.projects.find(x=>x.id===e.target.value);
        setProjectId(e.target.value);setDepartmentId(p?.department_id||'');
        setParticipatingDepartmentIds(p?.participating_department_ids??[]);
        setProgramId(p?.program_id||'');setDirectPortfolio(p?.portfolio_id||'');
      }} required><option value="">选择项目</option>{data.projects.map(x=>
        <option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
      <label>唯一主责部门<select value={departmentId} onChange={e=>{
        const next=e.target.value;
        setDepartmentId(next);
        setParticipatingDepartmentIds(old=>old.filter(id=>id!==next));
      }}>
        <option value="">未设置</option>{data.departments.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
      </select></label>
      <fieldset>
        <legend>参与部门（可多选）</legend>
        <small>仅用于组织协作与资源汇总，不会自动获得项目聊天和任务修改权限。</small>
        {data.departments.filter(x=>x.id!==departmentId).map(dep=>
          <label key={dep.id}>
            <input type="checkbox" checked={participatingDepartmentIds.includes(dep.id)}
              onChange={e=>setParticipatingDepartmentIds(old=>e.target.checked?
                [...old,dep.id].sort():old.filter(id=>id!==dep.id))}/>
            {dep.name}
          </label>)}
      </fieldset>
      <label>所属项目集<select value={programId} onChange={e=>{setProgramId(e.target.value);if(e.target.value)setDirectPortfolio('');}}>
        <option value="">独立项目</option>{data.programs.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
      </select></label>
      {!programId&&<label>直接归属项目组合<select value={directPortfolio} onChange={e=>setDirectPortfolio(e.target.value)}>
        <option value="">未设置</option>{data.portfolios.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
      </select></label>}
      <small>项目归属版本：v{data.projects.find(p=>p.id===projectId)?.classification_revision??'—'}
        · 其他管理员已修改时，旧版本保存会被拒绝</small>
      <div className="row-form">
        <button disabled={busy||!projectId}>保存归属</button>
        <button type="button" className="secondary" disabled={busy||!projectId}
          onClick={()=>void run(refreshClassification)}>刷新所选项目归属</button>
      </div>
    </form>
    </div>}
    {tab==='resources'&&<div className="stack organization-section">
    <h3>跨项目资源投入计划</h3>
    <p className="hint">同一人员在所有项目中的任意一天投入比例之和不能超过 100%。
      日期包含开始日和结束日；如果已有安排冲突，请调整日期或比例。</p>
    <form className="stack" onSubmit={e=>{e.preventDefault();void run(async()=>{
      await write(base+'/allocations','POST',{
        projectId,userId:assignee,percentage,startDate,endDate});
    });}}>
      <label>项目<select value={projectId} required onChange={e=>setProjectId(e.target.value)}>
        <option value="">选择项目</option>{data.projects.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
      </select></label>
      <label>人员<select value={assignee} required onChange={e=>setAssignee(e.target.value)}>
        <option value="">选择已加入项目的人员</option>{members.map(x=><option key={x.id} value={x.id}>{x.display_name}</option>)}
      </select></label>
      <label>投入比例 (%)<input type="number" min={1} max={100} value={percentage} onChange={e=>setPercentage(Number(e.target.value))}/></label>
      <div className="row-form">
        <label>开始<input type="date" value={startDate} required onChange={e=>setStartDate(e.target.value)}/></label>
        <label>结束<input type="date" value={endDate} required onChange={e=>setEndDate(e.target.value)}/></label>
      </div><button disabled={busy}>登记投入</button>
    </form>
    {allocations.map(a=><div className="row-form" key={a.id}>
      <p className="hint">
        {members.find(x=>x.id===a.user_id)?.display_name||a.user_id} · {data.projects.find(x=>x.id===a.project_id)?.name||a.project_id} ·
        {a.percentage}% · {a.start_date} ~ {a.end_date}
        {a.cancelled_at?' · 已取消':''}
      </p>
      {!a.cancelled_at&&<button type="button" className="secondary" disabled={busy}
        onClick={()=>{if(window.confirm('确定取消该资源投入计划？历史记录仍会保留。'))
          void run(async()=>{await write(base+'/allocations/'+a.id+'/cancel','POST',{});});}}>
        取消投入
      </button>}
    </div>)}
    </div>}
    {notice&&<p role="status" className="notice">{notice}</p>}
  </section>;
}
