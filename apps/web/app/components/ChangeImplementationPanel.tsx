'use client';
import {useState} from 'react';
import type {Message,Person} from './client';
import {request} from './client';

type Change={
  id:string;status?:string;version?:number;
  implementation_owner_id?:string|null;
  implementation_started_at?:string|null;
  implementation_evidence_message_id?:string|null;
};
type RecordItem={
  id:string;change_version:number;action:string;
  from_status:string;to_status:string;note:string;
  actor_id:string;evidence_message_id:string|null;occurred_at:string;
};
type History={history:RecordItem[];nextBeforeVersion:number|null};

export default function ChangeImplementationPanel({projectId,item,people,messages,
  actorId,canManage,busy,onCommand}:{
  projectId:string;item:Change;people:Person[];messages:Message[];
  actorId:string;canManage:boolean;busy:boolean;
  onCommand:(path:string,body:Record<string,unknown>)=>void;
}){
  const [nextOwner,setNextOwner]=useState('');
  const [executionNote,setExecutionNote]=useState('');
  const [verifyNote,setVerifyNote]=useState('');
  const [evidenceId,setEvidenceId]=useState('');
  const [history,setHistory]=useState<History|null>(null);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [historyError,setHistoryError]=useState('');
  const [reading,setReading]=useState(false);
  const eligible=messages.filter(m=>m.kind==='user'&&
    m.author_id===item.implementation_owner_id&&
    Boolean(item.implementation_started_at)&&
    new Date(m.created_at).getTime()>=
      new Date(item.implementation_started_at??'').getTime());
  const owners=people.filter(p=>p.role!=='observer');
  const current=people.find(p=>p.id===item.implementation_owner_id);
  function command(decision:'start'|'reassign'|'complete'){
    const rest=decision==='complete'
      ?{evidenceMessageId:evidenceId,note:verifyNote.trim()}
      :{ownerId:nextOwner,note:executionNote.trim()};
    onCommand('/changes/'+item.id+'/implementation',{
      decision,expectedVersion:item.version,...rest,
    });
  }
  async function loadHistory(beforeVersion?:number){
    setHistoryError('');setReading(true);
    try{
      const response=await request<History>(
        '/projects/'+projectId+'/pm/changes/'+item.id+'/implementation/history'+
        (beforeVersion?'?beforeVersion='+beforeVersion:''));
      setHistory(old=>({
        history:beforeVersion?[...(old?.history??[]),...response.history]:response.history,
        nextBeforeVersion:response.nextBeforeVersion,
      }));
      setHistoryOpen(true);
    }catch(e){setHistoryError(e instanceof Error?e.message:'读取实施历史失败');}
    finally{setReading(false);}
  }
  return <div className="stack">
    {item.implementation_owner_id&&<small>
      实施责任：{current?.display_name||'原成员'}
      {' · '}{item.status==='implemented'?'已复核完成':'实施中'}
    </small>}
    {canManage&&['approved','implementing'].includes(item.status??'')&&
      <div className="stack">
        <label>{item.status==='approved'?'指定实施负责人':'重新指派实施负责人'}
          <select value={nextOwner} onChange={e=>setNextOwner(e.target.value)}>
            <option value="">请选择当前有效成员</option>
            {owners.map(p=><option key={p.id} value={p.id}>
              {p.display_name}</option>)}
          </select>
        </label>
        <label>实施任务与原因说明
          <textarea rows={2} maxLength={2000} value={executionNote}
            onChange={e=>setExecutionNote(e.target.value)}/>
        </label>
        <button disabled={busy||!nextOwner||!executionNote.trim()||
          (item.status==='implementing'&&nextOwner===item.implementation_owner_id)}
          onClick={()=>command(item.status==='approved'?'start':'reassign')}>
          {item.status==='approved'?'启动批准变更的实施':'重新指派并重置证据起算时间'}
        </button>
      </div>}
    {item.status==='implementing'&&canManage&&actorId!==item.implementation_owner_id&&
      <div className="stack">
        <label>执行证据（来自当前负责人的原始项目消息）
          <select value={evidenceId} onChange={e=>setEvidenceId(e.target.value)}>
            <option value="">请选择实施启动后发布的消息</option>
            {eligible.map(m=><option key={m.id} value={m.id}>
              {m.content.slice(0,76)}</option>)}
          </select>
        </label>
        <label>独立复核说明
          <textarea rows={2} maxLength={2000} value={verifyNote}
            onChange={e=>setVerifyNote(e.target.value)}/>
        </label>
        {eligible.length===0&&<p className="hint">
          负责人需要先在项目聊天室发送可核实的实施证据。
        </p>}
        <button disabled={busy||!evidenceId||!verifyNote.trim()}
          onClick={()=>command('complete')}>依据原始证据复核实施完成</button>
      </div>}
    {item.status==='implemented'&&item.implementation_evidence_message_id&&
      <small>完成证据消息：{item.implementation_evidence_message_id}</small>}
    {item.status!=='approved'&&
      <button type="button" className="secondary" disabled={busy||reading}
        onClick={()=>historyOpen?setHistoryOpen(false):void loadHistory()}>
        {historyOpen?'收起实施历史':'查看实施历史'}
      </button>}
    {historyError&&<p role="alert">{historyError}</p>}
    {historyOpen&&history&&<div className="stack">
      {history.history.length===0&&<p className="hint">尚无实施记录</p>}
      {history.history.map(entry=><p key={entry.id}>
        <small>v{entry.change_version} · {entry.action==='start'?'启动实施':
          entry.action==='reassign'?'责任移交':'核验完成'} ·
          {people.find(p=>p.id===entry.actor_id)?.display_name||'历史成员'}
        </small>{' '}{entry.note}
        {entry.evidence_message_id&&<small>
          {' '}证据 ID：{entry.evidence_message_id}
        </small>}
      </p>)}
      {history.nextBeforeVersion&&<button type="button" className="secondary"
        disabled={reading||busy}
        onClick={()=>void loadHistory(history.nextBeforeVersion!)}>
        查看更早的实施记录</button>}
    </div>}
  </div>;
}
