'use client';
import { useEffect,useRef,useState,type FormEvent } from 'react';
import type { Message,Project,User } from './client';
import { json,request } from './client';

type Kind='work_progress'|'completion_claim'|'commitment'|'blocker'|
  'risk_signal'|'issue_signal'|'decision_signal'|'change_signal'|'observation';
type Claim={id:string;kind:Kind;summary:string;status:string;version:number;
  quote:string;author_id:string|null;source_message_id:string};
type Cursor={beforeAt:string;beforeId:string};
type Page={claims:Claim[];nextCursor:Cursor|null};
const kinds:Record<Kind,string>={
  work_progress:'进展线索',completion_claim:'完成声称',commitment:'个人承诺',
  blocker:'阻塞',risk_signal:'未来风险线索',issue_signal:'已发生问题线索',
  decision_signal:'决策线索',change_signal:'变更线索',observation:'观察',
};
export default function EvidencePanel({project,user,messages}:{
  project:Project;user:User;messages:Message[];
}){
  const base='/projects/'+project.id+'/evidence/claims';
  const [items,setItems]=useState<Claim[]>([]);
  const [cursor,setCursor]=useState<Cursor|null>(null);
  const [messageId,setMessageId]=useState('');
  const [quote,setQuote]=useState('');
  const [kind,setKind]=useState<Kind>('work_progress');
  const [summary,setSummary]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const key=useRef<string|null>(null);
  const manager=project.role==='owner'||project.role==='manager';
  const available=messages.filter(m=>m.kind==='user'&&
    (manager||m.author_id===user.id)).slice(-100).reverse();
  const selected=messages.find(m=>m.id===messageId);
  const startIndex=selected&&quote?selected.content.indexOf(quote):-1;
  const startCp=selected&&startIndex>=0
    ?Array.from(selected.content.slice(0,startIndex)).length:-1;
  const quoteLength=Array.from(quote).length;
  const validQuote=startCp>=0&&quoteLength>0&&quoteLength<=2000&&Boolean(quote.trim());
  const canCreate=project.role!=='observer'&&
    Boolean(selected&&(manager||selected.author_id===user.id));
  async function load(next?:Cursor){
    const suffix=next?'?beforeAt='+encodeURIComponent(next.beforeAt)+
      '&beforeId='+encodeURIComponent(next.beforeId):'';
    const r=await request<Page>(base+suffix);
    setItems(prev=>next?[...prev,...r.claims]:r.claims);
    setCursor(r.nextCursor);
  }
  useEffect(()=>{
    let active=true;
    void request<Page>(base).then(r=>{
      if(active){setItems(r.claims);setCursor(r.nextCursor);}
    }).catch(e=>{if(active)setNotice(e instanceof Error?e.message:'证据加载失败');});
    return()=>{active=false;};
  },[base]);
  async function act(fn:()=>Promise<void>){
    if(busy)return;
    setBusy(true);setNotice('');
    try{await fn();await load();}
    catch(e){setNotice(e instanceof Error?e.message:'证据操作失败');}
    finally{setBusy(false);}
  }
  function select(id:string){
    setMessageId(id);key.current=null;
    const source=messages.find(m=>m.id===id);
    setQuote(source?Array.from(source.content).slice(0,2000).join(''):'');
  }
  function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!selected||!validQuote||!canCreate)return;
    const idempotencyKey=key.current??crypto.randomUUID();
    key.current=idempotencyKey;
    void act(async()=>{
      await request(base,{method:'POST',body:json({idempotencyKey,
        messageId:selected.id,startCp,endCp:startCp+quoteLength,kind,summary})});
      key.current=null;setSummary('');
    });
  }
  function review(c:Claim,decision:'acknowledge'|'dismiss'){
    void act(async()=>{
      await request(base+'/'+c.id+'/review',{method:'POST',body:json({
        idempotencyKey:crypto.randomUUID(),expectedVersion:c.version,decision})});
    });
  }
  return <section className="pm-category evidence-panel">
    <h3>聊天证据与待核实主张 ({items.length})</h3>
    <p className="hint">记录原始发言及解释。来源人确认不代表任务已完成或交付物已验收。</p>
    {available.length>0&&<form className="stack pm-create" onSubmit={submit}>
      <label>来源消息<select value={messageId} onChange={e=>select(e.target.value)}>
        <option value="">选择项目内发言</option>
        {available.map(m=><option key={m.id} value={m.id}>
          {(m.author||'成员')+'：'+m.content.slice(0,70)}
        </option>)}
      </select></label>
      <label>准确引用原文片段<textarea rows={3} value={quote}
        onChange={e=>{setQuote(e.target.value);key.current=null;}}
        placeholder="保留或裁剪消息原文，不能改写内容"/></label>
      {quote&&!validQuote&&<p className="hint">引文必须存在于原消息中，且不超过 2000 个字符。</p>}
      <label>主张类型<select value={kind}
        onChange={e=>{setKind(e.target.value as Kind);key.current=null;}}>
        {(Object.entries(kinds) as [Kind,string][]).map(([k,v])=>
          <option key={k} value={k}>{v}</option>)}
      </select></label>
      <label>需要核实的解释<textarea rows={2} required maxLength={2000}
        value={summary} onChange={e=>{setSummary(e.target.value);key.current=null;}}/>
      </label>
      <button disabled={busy||!canCreate||!validQuote||!summary.trim()}>登记待核实主张</button>
    </form>}
    {!available.length&&<p className="hint">暂无可引用的成员发言。</p>}
    {items.map(c=><article className="item evidence-claim" key={c.id}>
      <small>{kinds[c.kind]} · {c.status==='pending'?'待来源确认':
        c.status==='source_acknowledged'?'来源已确认':'已驳回'} · v{c.version}</small>
      <blockquote>{c.quote}</blockquote>
      <p>解释：{c.summary}</p>
      {c.status==='pending'&&<div className="actions pm-actions">
        {c.author_id===user.id&&project.role!=='observer'&&
          <button disabled={busy} onClick={()=>review(c,'acknowledge')}>确认这是我的表述</button>}
        {manager&&<button className="secondary" disabled={busy}
          onClick={()=>review(c,'dismiss')}>驳回解释</button>}
      </div>}
    </article>)}
    {cursor&&<button className="secondary" disabled={busy}
      onClick={()=>{setBusy(true);void load(cursor).catch(e=>{
        setNotice(e instanceof Error?e.message:'分页失败');
      }).finally(()=>setBusy(false));}}>加载更早记录</button>}
    {notice&&<p className="notice" role="alert">{notice}</p>}
  </section>;
}
