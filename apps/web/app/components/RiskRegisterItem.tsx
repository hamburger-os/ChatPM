'use client';
import {useState,type FormEvent} from 'react';
import type {Person,Risk} from './client';
import {request} from './client';

type Change={id:string,risk_version:number,action:string,from_status:string,
  to_status:string,note:string,occurred_at:string};
type Decision='start_mitigation'|'resolve'|'reopen';
const stateNames:Record<Risk['status'],string>={
  open:'待评估 / 开放',mitigating:'应对中',resolved:'已解决',
};
export default function RiskRegisterItem({risk,people,canManage,busy,projectId,
  onAssess,onTransition}:{
  risk:Risk;people:Person[];canManage:boolean;busy:boolean;projectId:string;
  onAssess:(data:Record<string,unknown>)=>void;
  onTransition:(decision:Decision,note:string)=>void;
}){
  const [likelihood,setLikelihood]=useState(risk.likelihood??3);
  const [impact,setImpact]=useState(risk.impact??3);
  const [ownerId,setOwnerId]=useState(risk.owner_id??'');
  const [plan,setPlan]=useState(risk.response_plan??'');
  const [assessmentNote,setAssessmentNote]=useState('');
  const [transitionNote,setTransitionNote]=useState('');
  const [history,setHistory]=useState<Change[]|null>(null);
  const [historyError,setHistoryError]=useState('');
  const [showHistory,setShowHistory]=useState(false);
  const controls=people.filter(p=>p.role!=='observer');
  function assess(e:FormEvent){
    e.preventDefault();
    if(!ownerId)return;
    onAssess({likelihood,impact,ownerId,responsePlan:plan,note:assessmentNote});
  }
  async function readHistory(){
    if(showHistory){setShowHistory(false);return;}
    setShowHistory(true);setHistoryError('');
    try{
      const result=await request<{history:Change[]}>(
        '/projects/'+projectId+'/risks/'+risk.id+'/history');
      setHistory(result.history);
    }catch(error){setHistoryError(error instanceof Error?error.message:'读取记录失败');}
  }
  const decision:Decision=risk.status==='open'?'start_mitigation':
    risk.status==='mitigating'?'resolve':'reopen';
  const decisionText=decision==='start_mitigation'?'开始应对':
    decision==='resolve'?'确认解决':'重新打开';
  return <article className="item">
    <strong>{risk.title}</strong>
    <p>{risk.detail}</p>
    <small>{stateNames[risk.status]} · 版本 {risk.version} · 
      负责人：{people.find(p=>p.id===risk.owner_id)?.display_name||
        (risk.owner_id?'已不在本项目':'待指派')}
      {risk.likelihood&&risk.impact?' · 可能性 '+risk.likelihood+
        '/5 · 影响 '+risk.impact+'/5':''}</small>
    {risk.response_plan&&<p>应对计划：{risk.response_plan}</p>}
    {canManage&&risk.status!=='resolved'&&<details>
      <summary>评估风险 / 调整应对</summary>
      <form className="stack" onSubmit={assess}>
        <label>发生可能性（1–5）
          <select value={likelihood} onChange={e=>setLikelihood(Number(e.target.value))}>
            {[1,2,3,4,5].map(n=><option value={n} key={n}>{n}</option>)}
          </select>
        </label>
        <label>影响程度（1–5）
          <select value={impact} onChange={e=>setImpact(Number(e.target.value))}>
            {[1,2,3,4,5].map(n=><option value={n} key={n}>{n}</option>)}
          </select>
        </label>
        <label>负责应对人员
          <select required value={ownerId} onChange={e=>setOwnerId(e.target.value)}>
            <option value="">请选择</option>
            {controls.map(person=><option key={person.id} value={person.id}>
              {person.display_name}</option>)}
          </select>
        </label>
        <label>应对计划
          <textarea required maxLength={5000} value={plan}
            onChange={e=>setPlan(e.target.value)}/>
        </label>
        <label>评估记录
          <textarea required maxLength={2000} value={assessmentNote}
            onChange={e=>setAssessmentNote(e.target.value)}/>
        </label>
        <button disabled={busy||!ownerId}>保存风险评估</button>
      </form>
    </details>}
    {canManage&&<div className="stack">
      <label>流转说明
        <textarea required maxLength={2000} value={transitionNote}
          onChange={e=>setTransitionNote(e.target.value)}/>
      </label>
      <button disabled={busy||!transitionNote.trim()}
        onClick={()=>onTransition(decision,transitionNote)}>{decisionText}</button>
    </div>}
    <button type="button" className="secondary"
      onClick={()=>void readHistory()}>{showHistory?'收起历史':'查看变更历史'}</button>
    {showHistory&&<>
      {historyError&&<p role="alert">{historyError}</p>}
      {history?.length===0&&<p className="hint">暂无变更历史</p>}
      {history?.map(change=><p key={change.id}>
        <small>v{change.risk_version} · {change.action==='assessment'?'评估':'状态变更'}
          {' · '}{change.from_status} → {change.to_status}
          {' · '}{new Date(change.occurred_at).toLocaleString()}</small>
        {' '}{change.note}
      </p>)}
    </>}
  </article>;
}
