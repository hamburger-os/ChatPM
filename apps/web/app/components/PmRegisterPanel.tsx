'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Person, Project, Task, User } from './client';
import { json, request } from './client';

type Kind='goals'|'milestones'|'deliverables'|'issues'|'decisions'|'changes';
type Entry={
  id:string;title:string;status?:string;version?:number;
  description?:string;detail?:string;rationale?:string;impact?:string;
  success_criteria?:string;acceptance_criteria?:string;
  due_date?:string|null;assignee_id?:string;submitted_by?:string|null;
  created_by?:string;severity?:string;goal_id?:string|null;milestone_id?:string|null;
};
type Registry=Record<Kind,Entry[]>;
type Dependency={dependent_task_id:string;prerequisite_task_id:string};
const kinds:Kind[]=['goals','milestones','deliverables','issues','decisions','changes'];
const labels:Record<Kind,string>={
  goals:'项目目标',milestones:'里程碑',deliverables:'交付与验收',
  issues:'已发生问题',decisions:'项目决策',changes:'变更申请',
};
const empty:Registry={goals:[],milestones:[],deliverables:[],
  issues:[],decisions:[],changes:[]};
const statusText:Record<string,string>={
  planned:'计划中',submitted:'待验收',accepted:'已验收',
  returned:'已退回',open:'处理中',resolved:'已解决',
  pending:'待审批',approved:'已批准',rejected:'已拒绝',
};

export default function PmRegisterPanel({project,user,people,tasks}:{
  project:Project;user:User;people:Person[];tasks:Task[];
}){
  const [data,setData]=useState<Registry>(empty);
  const [dependencies,setDependencies]=useState<Dependency[]>([]);
  const [kind,setKind]=useState<Kind>('goals');
  const [title,setTitle]=useState('');
  const [detail,setDetail]=useState('');
  const [criteria,setCriteria]=useState('');
  const [due,setDue]=useState('');
  const [assignee,setAssignee]=useState('');
  const [goalId,setGoalId]=useState('');
  const [milestoneId,setMilestoneId]=useState('');
  const [severity,setSeverity]=useState<'low'|'medium'|'high'|'critical'>('medium');
  const [dependent,setDependent]=useState('');
  const [prerequisite,setPrerequisite]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const keyRef=useRef<string|null>(null);
  const base='/projects/'+project.id+'/pm';
  const canPlan=project.role==='owner'||project.role==='manager';
  const owner=project.role==='owner';

  async function refresh(){
    const [register,links]=await Promise.all([
      request<Registry>(base),
      request<{dependencies:Dependency[]}>(base+'/dependencies'),
    ]);
    setData(register);setDependencies(links.dependencies);
  }
  useEffect(()=>{
    let active=true;
    Promise.all([request<Registry>(base),
      request<{dependencies:Dependency[]}>(base+'/dependencies')])
      .then(([register,links])=>{
        if(active){setData(register);setDependencies(links.dependencies);}
      }).catch(e=>{if(active)setNotice(e instanceof Error?e.message:'治理信息加载失败');});
    return ()=>{active=false;};
  },[base]);

  async function execute(job:()=>Promise<void>){
    if(busy)return;
    setBusy(true);setNotice('');
    try{await job();await refresh();}
    catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setBusy(false);}
  }
  function inputChanged(setter:(value:string)=>void,value:string){
    setter(value);keyRef.current=null;
  }
  function changeKind(next:Kind){
    setKind(next);setTitle('');setDetail('');setCriteria('');
    setDue('');setAssignee('');setGoalId('');setMilestoneId('');
    keyRef.current=null;
  }
  function create(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const idempotencyKey=keyRef.current??crypto.randomUUID();
    keyRef.current=idempotencyKey;
    const fields=kind==='goals'
      ?{description:detail,successCriteria:criteria}
      :kind==='milestones'
        ?{dueDate:due,goalId:goalId||null}
        :kind==='deliverables'
          ?{acceptanceCriteria:criteria,assigneeId:assignee,
            milestoneId:milestoneId||null,dueDate:due||null}
          :kind==='issues'
            ?{detail,severity,ownerId:assignee||null}
            :kind==='decisions'?{rationale:detail}
              :{rationale:detail,impact:criteria};
    void execute(async()=>{
      await request(base+'/'+kind,{method:'POST',
        body:json({idempotencyKey,title,...fields})});
      keyRef.current=null;
      setTitle('');setDetail('');setCriteria('');setDue('');
      setAssignee('');setGoalId('');setMilestoneId('');
    });
  }
  function transition(path:string,body:Record<string,unknown>){
    void execute(async()=>{
      await request(base+path,{method:'POST',
        body:json({idempotencyKey:crypto.randomUUID(),...body})});
    });
  }
  const memberNames=new Map(people.map(x=>[x.id,x.display_name]));
  const taskNames=new Map(tasks.map(x=>[x.id,x.title]));
  const visiblePeople=people.filter(x=>x.role!=='observer');

  return <div className="pm-register">
    <h3>项目治理登记簿</h3>
    <p className="hint">正式项目记录需人员授权确认；聊天中的 AI 建议不能直接成为交付验收或项目变更。</p>
    {canPlan&&<form className="stack pm-create" onSubmit={create}>
      <label>登记类型
        <select value={kind} onChange={e=>changeKind(e.target.value as Kind)}>
          {kinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}
        </select>
      </label>
      <label>标题<input required maxLength={250} value={title}
        onChange={e=>inputChanged(setTitle,e.target.value)} placeholder="明确可核实的事项"/></label>
      {(['goals','issues','decisions','changes'] as Kind[]).includes(kind)&&
        <label>{kind==='decisions'||kind==='changes'?'选择依据':'描述'}
          <textarea rows={2} required={kind==='decisions'||kind==='changes'}
            maxLength={5000} value={detail}
            onChange={e=>inputChanged(setDetail,e.target.value)}/>
        </label>}
      {(['goals','deliverables','changes'] as Kind[]).includes(kind)&&
        <label>{kind==='goals'?'成功标准':kind==='deliverables'?'验收标准':'基线影响'}
          <textarea rows={2} required maxLength={3000} value={criteria}
            onChange={e=>inputChanged(setCriteria,e.target.value)}/>
        </label>}
      {(['milestones','deliverables'] as Kind[]).includes(kind)&&
        <label>计划日期
          <input type="date" required={kind==='milestones'} value={due}
            onChange={e=>inputChanged(setDue,e.target.value)}/>
        </label>}
      {kind==='milestones'&&<label>关联项目目标（可选）
        <select value={goalId} onChange={e=>inputChanged(setGoalId,e.target.value)}>
          <option value="">不关联</option>
          {data.goals.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}
        </select></label>}
      {kind==='deliverables'&&<label>关联里程碑（可选）
        <select value={milestoneId} onChange={e=>inputChanged(setMilestoneId,e.target.value)}>
          <option value="">不关联</option>
          {data.milestones.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}
        </select></label>}
      {(kind==='deliverables'||kind==='issues')&&<label>负责人
        <select required={kind==='deliverables'} value={assignee}
          onChange={e=>inputChanged(setAssignee,e.target.value)}>
          <option value="">{kind==='deliverables'?'请选择负责人':'暂未指定'}</option>
          {visiblePeople.map(x=><option key={x.id} value={x.id}>{x.display_name}</option>)}
        </select></label>}
      {kind==='issues'&&<label>严重程度
        <select value={severity} onChange={e=>{setSeverity(e.target.value as typeof severity);keyRef.current=null;}}>
          <option value="low">低</option><option value="medium">中</option>
          <option value="high">高</option><option value="critical">严重</option>
        </select></label>}
      <button disabled={busy}>登记{labels[kind]}</button>
    </form>}
    {kinds.map(k=><section className="pm-category" key={k}>
      <h3>{labels[k]} ({data[k].length})</h3>
      {data[k].length===0&&<p className="hint">暂无记录</p>}
      {data[k].map(item=><article key={item.id} className="item">
        <strong>{item.title}</strong>
        {item.status&&<small>{statusText[item.status]||item.status} · v{item.version}</small>}
        {item.description&&<p>{item.description}</p>}
        {item.detail&&<p>{item.detail}</p>}
        {item.rationale&&<p>依据：{item.rationale}</p>}
        {item.success_criteria&&<p>目标：{item.success_criteria}</p>}
        {item.acceptance_criteria&&<p>验收：{item.acceptance_criteria}</p>}
        {item.impact&&<p>影响：{item.impact}</p>}
        {item.due_date&&<small>日期：{item.due_date.slice(0,10)}</small>}
        {item.assignee_id&&<small>负责人：{memberNames.get(item.assignee_id)||'历史成员'}</small>}
        {k==='deliverables'&&item.version&&
          <div className="actions pm-actions">
            {item.assignee_id===user.id&&['planned','returned'].includes(item.status||'')&&
              <button disabled={busy} onClick={()=>transition(
                '/deliverables/'+item.id+'/submit',{expectedVersion:item.version})}>提交验收</button>}
            {canPlan&&item.status==='submitted'&&item.submitted_by!==user.id&&<>
              <button disabled={busy} onClick={()=>transition(
                '/deliverables/'+item.id+'/review',
                {expectedVersion:item.version,decision:'accept'})}>验收通过</button>
              <button className="secondary" disabled={busy} onClick={()=>transition(
                '/deliverables/'+item.id+'/review',
                {expectedVersion:item.version,decision:'return'})}>退回</button>
            </>}
          </div>}
        {k==='changes'&&owner&&item.version&&item.status==='pending'&&
          item.created_by!==user.id&&<div className="actions pm-actions">
            <button disabled={busy} onClick={()=>transition('/changes/'+item.id+'/decide',
              {expectedVersion:item.version,decision:'approve'})}>批准变更</button>
            <button className="secondary" disabled={busy} onClick={()=>transition(
              '/changes/'+item.id+'/decide',
              {expectedVersion:item.version,decision:'reject'})}>拒绝</button>
          </div>}
      </article>)}
    </section>)}
    <section className="pm-category">
      <h3>任务依赖 ({dependencies.length})</h3>
      {canPlan&&<form className="stack pm-create" onSubmit={e=>{
        e.preventDefault();transition('/dependencies',
          {dependentTaskId:dependent,prerequisiteTaskId:prerequisite});
      }}>
        <label>受约束任务
          <select required value={dependent} onChange={e=>setDependent(e.target.value)}>
            <option value="">请选择</option>{tasks.map(t=>
              <option key={t.id} value={t.id}>{t.title}</option>)}
          </select></label>
        <label>前置任务
          <select required value={prerequisite} onChange={e=>setPrerequisite(e.target.value)}>
            <option value="">请选择</option>{tasks.filter(t=>t.id!==dependent).map(t=>
              <option key={t.id} value={t.id}>{t.title}</option>)}
          </select></label>
        <button disabled={busy||!dependent||!prerequisite||dependent===prerequisite}>登记依赖</button>
      </form>}
      {dependencies.map((d,i)=><p className="pm-dependency" key={i}>
        {taskNames.get(d.dependent_task_id)||'历史任务'} 依赖 → {taskNames.get(d.prerequisite_task_id)||'历史任务'}
      </p>)}
    </section>
    {notice&&<p className="notice" role="alert">{notice}</p>}
    <button className="secondary" disabled={busy} onClick={()=>void execute(async()=>{})}>刷新登记簿</button>
  </div>;
}
