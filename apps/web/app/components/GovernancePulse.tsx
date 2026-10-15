'use client';
import {useEffect,useState} from 'react';

type Metrics={
  project_count:number;tasks_total:number;tasks_done:number;tasks_cancelled:number;
  tasks_blocked:number;tasks_overdue:number;risks_open:number;
  planned_percentage_points:number;
};
type ProjectPulse=Metrics extends never?never:{
  id:string;name:string;department_id:string|null;
  program_id:string|null;effective_portfolio_id:string|null;
  tasks_total:number;tasks_done:number;tasks_cancelled:number;
  tasks_blocked:number;tasks_overdue:number;risks_open:number;
  planned_percentage_points:number;
};
type Group=Metrics&{id:string;name:string;portfolio_id?:string|null};
type Resource={
  user_id:string;display_name:string;email:string;
  planned_percentage:number;project_count:number;
  capacity_status:'within_capacity'|'near_capacity'|'overallocated';
};
type Snapshot={
  as_of_date:string;generated_at:string;totals:Metrics;
  programs:Group[];portfolios:Group[];projects:ProjectPulse[];
  unassigned_projects:ProjectPulse[];resources:Resource[];
};
const localDate=()=>{
  const d=new Date();
  return new Date(d.getTime()-d.getTimezoneOffset()*60_000).toISOString().slice(0,10);
};
function totalsLine(m:Metrics){
  const planned=m.tasks_total-m.tasks_cancelled;
  return '项目 '+m.project_count+' · 任务完成 '+m.tasks_done+'/'+planned+
    '（不含取消 '+m.tasks_cancelled+'） · 阻塞 '+m.tasks_blocked+
    ' · 逾期 '+m.tasks_overdue+' · 未解决风险 '+m.risks_open+
    ' · 投入百分点合计 '+m.planned_percentage_points;
}
function projectLine(p:ProjectPulse){
  return p.name+' · 完成 '+p.tasks_done+'/'+(p.tasks_total-p.tasks_cancelled)+
    ' · 阻塞 '+p.tasks_blocked+' · 逾期 '+p.tasks_overdue+
    ' · 风险 '+p.risks_open;
}
export default function GovernancePulse({tenantId}:{tenantId:string}){
  const [on,setOn]=useState(localDate);
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [showAllPeople,setShowAllPeople]=useState(false);
  useEffect(()=>{
    let live=true;
    setBusy(true);setError('');
    void fetch('/api/tenants/'+tenantId+'/governance-pulse?on='+on,{
      credentials:'include',cache:'no-store',
    }).then(async response=>{
      const payload=await response.json() as Snapshot&{error?:string};
      if(!response.ok)throw new Error(payload.error||'汇总读取失败');
      if(live)setSnapshot(payload);
    }).catch(e=>{if(live){setSnapshot(null);setError(e instanceof Error?e.message:'无法读取');}})
      .finally(()=>{if(live)setBusy(false);});
    return ()=>{live=false;};
  },[tenantId,on]);
  const projects=snapshot?.projects??[];
  const listed=(items:ProjectPulse[])=>
    <ul>{items.length?items.map(p=><li key={p.id}>{projectLine(p)}</li>):
      <li>暂无项目</li>}</ul>;
  return <section className="stack">
    <h3>项目集、项目组合与人员投入概览</h3>
    <p className="hint">任务状态与风险是生成时的当前事实，不支持历史状态回放。
      所选日期只影响逾期判断和当天有效的资源计划。投入百分点是跨人员计划比例相加，
      不是工时、真实利用率或收益兑现率。</p>
    <label>计划及到期查询日期
      <input type="date" value={on} onChange={e=>setOn(e.target.value||localDate())}/>
    </label>
    {busy&&<p className="hint">正在读取正式项目记录…</p>}
    {error&&<p role="alert">{error}</p>}
    {snapshot&&<>
      <small>汇总日期 {snapshot.as_of_date} · 生成于
        {' '+new Date(snapshot.generated_at).toLocaleString()}</small>
      <div className="item"><strong>全部项目（去重）</strong>
        <p>{totalsLine(snapshot.totals)}</p>
      </div>
      <h3>项目组合（战略投资维度）</h3>
      {snapshot.portfolios.map(portfolio=><div key={portfolio.id} className="item">
        <strong>{portfolio.name}</strong>
        <p className="hint">{totalsLine(portfolio)}</p>
        {listed(projects.filter(p=>p.effective_portfolio_id===portfolio.id))}
      </div>)}
      {!snapshot.portfolios.length&&<p className="hint">尚未创建项目组合</p>}
      <h3>项目集（跨项目协调维度）</h3>
      {snapshot.programs.map(program=><div key={program.id} className="item">
        <strong>{program.name}</strong>
        <small>{program.portfolio_id?'归属于项目组合':'独立项目集'}</small>
        <p className="hint">{totalsLine(program)}</p>
        {listed(projects.filter(p=>p.program_id===program.id))}
      </div>)}
      {!snapshot.programs.length&&<p className="hint">尚未创建项目集</p>}
      <h3>未归入项目集或组合的项目</h3>
      {listed(snapshot.unassigned_projects)}
      <h3>资源投入计划（当天有效）</h3>
      <p className="hint">按人员跨所有项目累计；80% 及以上列为接近容量，
        超过 100% 为超配（新录入应被资源分配规则阻止）。</p>
      {snapshot.resources.filter(p=>showAllPeople||p.planned_percentage>=80)
        .map(person=><div className="member" key={person.user_id}>
          <strong>{person.display_name}</strong>
          <small>{person.planned_percentage}% · 涉及 {person.project_count} 个项目
            {person.capacity_status==='overallocated'?' · 超配':
              person.capacity_status==='near_capacity'?' · 接近容量':''}</small>
        </div>)}
      {!snapshot.resources.some(p=>p.planned_percentage>=80)&&!showAllPeople&&
        <p className="hint">没有达到 80% 投入的人员</p>}
      {!snapshot.resources.length&&<p className="hint">当天没有有效的资源投入计划</p>}
      {snapshot.resources.length>0&&<button type="button" className="secondary"
        onClick={()=>setShowAllPeople(v=>!v)}>
        {showAllPeople?'仅显示高投入':'查看全部人员投入'}
      </button>}
    </>}
  </section>;
}
