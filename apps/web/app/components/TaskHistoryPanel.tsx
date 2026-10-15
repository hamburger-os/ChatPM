'use client';
import { useEffect,useState } from 'react';
import { request } from './client';

type Entry={
  id:string;kind:'created'|'updated';task_version:number;
  before_status:string|null;after_status:string;
  before_title:string|null;after_title:string;
  before_due_date:string|null;after_due_date:string|null;
  changed_at:string;
};
type Cursor={beforeAt:string;beforeId:string}|null;
type Page={history:Entry[];nextCursor:Cursor};

export default function TaskHistoryPanel({projectId,taskId}:{
  projectId:string;taskId:string;
}){
  const [events,setEvents]=useState<Entry[]>([]);
  const [next,setNext]=useState<Cursor>(null);
  const [busy,setBusy]=useState(true);
  const [notice,setNotice]=useState('');
  const path='/projects/'+projectId+'/tasks/'+taskId+'/history';
  useEffect(()=>{
    let active=true;
    setBusy(true);setNotice('');
    void request<Page>(path).then(page=>{
      if(!active)return;
      setEvents(page.history);setNext(page.nextCursor);
    }).catch(e=>{if(active)setNotice(e instanceof Error?e.message:'无法读取任务历史');})
      .finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[path]);
  async function loadMore(){
    if(!next||busy)return;
    setBusy(true);setNotice('');
    try{
      const query=new URLSearchParams(next);
      const page=await request<Page>(path+'?'+query);
      setEvents(old=>[...old,...page.history]);
      setNext(page.nextCursor);
    }catch(e){setNotice(e instanceof Error?e.message:'历史加载失败');}
    finally{setBusy(false);}
  }
  return <div className="stack">
    <small>任务变更历史（启用日志后记录，不补造既往操作）</small>
    {events.map(e=><div className="hint" key={e.id}>
      <strong>{e.kind==='created'?'创建任务':'版本 '+e.task_version}</strong>
      {' · '+new Date(e.changed_at).toLocaleString()}
      {e.before_status!==e.after_status&&
        <span> · 状态：{e.before_status??'未创建'} → {e.after_status}</span>}
      {e.before_due_date!==e.after_due_date&&
        <span> · 期限：{e.before_due_date??'未设置'} → {e.after_due_date??'未设置'}</span>}
      {e.kind==='updated'&&e.before_title!==e.after_title&&
        <span> · 名称：{e.before_title??''} → {e.after_title}</span>}
      <small> · 证据：{e.id}</small>
    </div>)}
    {!busy&&!events.length&&!notice&&<small>目前没有任务历史事件</small>}
    {next&&<button type="button" className="secondary" disabled={busy}
      onClick={()=>void loadMore()}>加载更早历史</button>}
    {notice&&<small role="alert">{notice}</small>}
  </div>;
}
