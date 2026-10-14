'use client';
import { useEffect, useState, type FormEvent } from 'react';
type Item={id:string;name:string;description?:string;parent_id?:string|null;portfolio_id?:string|null};
type Project=Item&{department_id:string|null;program_id:string|null;portfolio_id:string|null};
type Member={id:string;display_name:string;email:string;role:'admin'|'member'};
type Allocation={id:string;project_id:string;user_id:string;percentage:number;start_date:string;end_date:string};
type Structure={departments:Item[];portfolios:Item[];programs:Item[];projects:Project[]};
const empty:Structure={departments:[],portfolios:[],programs:[],projects:[]};
async function api<T>(path:string,options?:RequestInit):Promise<T>{
  const response=await fetch('/api'+path,{...options,credentials:'include',cache:'no-store',
    headers:{'Content-Type':'application/json',...options?.headers}});
  const data=await response.json().catch(()=>({error:'暂时无法访问服务'}));
  if(!response.ok)throw new Error(data.error||'操作失败');
  return data as T;
}
export default function OrganizationPanel({tenantId}:{tenantId:string}){
  const [data,setData]=useState<Structure>(empty);
  const [members,setMembers]=useState<Member[]>([]);
  const [allocations,setAllocations]=useState<Allocation[]>([]);
  const [kind,setKind]=useState<'departments'|'portfolios'|'programs'>('departments');
  const [name,setName]=useState('');
  const [portfolio,setPortfolio]=useState('');
  const [projectId,setProjectId]=useState('');
  const [departmentId,setDepartmentId]=useState('');
  const [programId,setProgramId]=useState('');
  const [directPortfolio,setDirectPortfolio]=useState('');
  const [email,setEmail]=useState('');
  const [assignee,setAssignee]=useState('');
  const [percentage,setPercentage]=useState(50);
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const base='/tenants/'+tenantId;
  async function reload(){
    const [s,m,a]=await Promise.all([
      api<Structure>(base+'/structure'),
      api<{members:Member[]}>(base+'/members'),
      api<{allocations:Allocation[]}>(base+'/allocations')]);
    setData(s);setMembers(m.members);setAllocations(a.allocations);
  }
  useEffect(()=>{void reload().catch(e=>setNotice(e.message));},[tenantId]);
  async function run(fn:()=>Promise<void>){
    setBusy(true);setNotice('');
    try{await fn();await reload();}
    catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setBusy(false);}
  }
  const create=(e:FormEvent)=>{
    e.preventDefault();void run(async()=>{
      await api(base+'/'+kind,{method:'POST',body:JSON.stringify({
        name,...(kind==='programs'?{portfolioId:portfolio||null}:{})})});
      setName('');
    });
  };
  const classification=(e:FormEvent)=>{
    e.preventDefault();void run(async()=>{
      await api(base+'/projects/'+projectId+'/classification',{method:'PATCH',
        body:JSON.stringify({departmentId:departmentId||null,programId:programId||null,
          portfolioId:programId?null:directPortfolio||null})});
    });
  };
  return <section className="stack">
    <h3>组织管理</h3>
    <p className="hint">部门管理人员与资源；项目集协调关联项目；项目组合管理战略与投入。部门成员不会自动获得项目聊天访问权限。</p>
    <h3>组织人员（{members.length}）</h3>
    {members.map(m=><div className="member" key={m.id}>
      <strong>{m.display_name}</strong><small>{m.email}</small>
      <select aria-label={'组织角色：'+m.display_name} value={m.role} disabled={busy} onChange={e=>void run(async()=>{
        await api(base+'/members/'+m.id,{method:'PATCH',body:JSON.stringify({role:e.target.value})});
      })}><option value="admin">组织管理员</option><option value="member">成员</option></select>
    </div>)}
    <form className="row-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
      await api(base+'/members',{method:'POST',body:JSON.stringify({email})});setEmail('');
    });}}>
      <input type="email" placeholder="将已注册人员加入组织" required value={email} onChange={e=>setEmail(e.target.value)}/>
      <button disabled={busy}>加入</button>
    </form>
    <h3>部门 / 项目组合 / 项目集</h3>
    {(['departments','portfolios','programs'] as const).map(k=><div key={k} className="item">
      <strong>{({departments:'部门',portfolios:'项目组合',programs:'项目集'})[k]} ({data[k].length})</strong>
      {data[k].map(x=><p key={x.id} className="hint">{x.name}</p>)}
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
        setProgramId(p?.program_id||'');setDirectPortfolio(p?.portfolio_id||'');
      }} required><option value="">选择项目</option>{data.projects.map(x=>
        <option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
      <label>主部门<select value={departmentId} onChange={e=>setDepartmentId(e.target.value)}>
        <option value="">未设置</option>{data.departments.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
      </select></label>
      <label>所属项目集<select value={programId} onChange={e=>{setProgramId(e.target.value);if(e.target.value)setDirectPortfolio('');}}>
        <option value="">独立项目</option>{data.programs.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
      </select></label>
      {!programId&&<label>直接归属项目组合<select value={directPortfolio} onChange={e=>setDirectPortfolio(e.target.value)}>
        <option value="">未设置</option>{data.portfolios.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
      </select></label>}
      <button disabled={busy||!projectId}>保存归属</button>
    </form>
    <h3>跨项目资源投入计划</h3>
    <form className="stack" onSubmit={e=>{e.preventDefault();void run(async()=>{
      await api(base+'/allocations',{method:'POST',body:JSON.stringify({
        projectId,userId:assignee,percentage,startDate,endDate})});
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
    {allocations.map(a=><p className="hint" key={a.id}>
      {members.find(x=>x.id===a.user_id)?.display_name||a.user_id} · {data.projects.find(x=>x.id===a.project_id)?.name||a.project_id} ·
      {a.percentage}% · {a.start_date} ~ {a.end_date}
    </p>)}
    {notice&&<p role="status" className="notice">{notice}</p>}
  </section>;
}
