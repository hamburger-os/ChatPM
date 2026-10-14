'use client';
import { useEffect, useState, type FormEvent } from 'react';

type Model={
  id:string;name:string;model:string;baseUrl:string;
  style:'responses'|'chat-completions';
  reasoning:'auto'|'none'|'low'|'medium'|'high'|'max';
  maxOutputTokens:number;contextChars:number;enabled:boolean;isDefault:boolean;hasKey:boolean;
};
const blank={name:'',model:'',baseUrl:'https://api.openai.com/v1',
  style:'responses' as Model['style'],reasoning:'auto' as Model['reasoning'],
  maxOutputTokens:8192,contextChars:32768,enabled:false,isDefault:false,apiKey:''};

async function api<T>(path:string,init?:RequestInit):Promise<T>{
  const r=await fetch('/api'+path,{...init,credentials:'include',cache:'no-store',
    headers:{'Content-Type':'application/json',...init?.headers}});
  const x=await r.json().catch(()=>({error:'服务暂时不可用'}));
  if(!r.ok)throw new Error(x.error||'请求失败');
  return x as T;
}
export default function AdminModelPanel(){
  const [models,setModels]=useState<Model[]>([]);
  const [editing,setEditing]=useState<string|null>(null);
  const [form,setForm]=useState(blank);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const reload=async()=>setModels((await api<{models:Model[]}>('/admin/ai/models')).models);
  useEffect(()=>{void reload().catch(e=>setNotice(e.message));},[]);
  const choose=(m:Model)=>{
    setEditing(m.id);
    setForm({name:m.name,model:m.model,baseUrl:m.baseUrl,style:m.style,
      reasoning:m.reasoning,maxOutputTokens:m.maxOutputTokens,
      contextChars:m.contextChars,enabled:m.enabled,isDefault:m.isDefault,apiKey:''});
    setNotice('');
  };
  const run=async(fn:()=>Promise<void>)=>{
    setBusy(true);setNotice('');
    try{await fn();}catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setBusy(false);}
  };
  const save=(e:FormEvent)=>{
    e.preventDefault();
    void run(async()=>{
      const path='/admin/ai/models'+(editing?'/'+editing:'');
      await api(path,{method:editing?'PUT':'POST',body:JSON.stringify(form)});
      await reload();setNotice('配置已保存');setEditing(null);setForm(blank);
    });
  };
  return <section className="stack">
    <h3>AI 模型管理（仅系统总管理员）</h3>
    <p className="hint">模型由平台统一管理。项目成员不需要填写 Key；修改默认模型将影响已授权启用 AI 的项目。</p>
    {models.map(m=><article className="item" key={m.id}>
      <strong>{m.name}</strong>
      <small>{m.model} · {m.style} · {m.enabled?'已启用':'停用'} · {m.isDefault?'默认模型':''}</small>
      <div className="actions">
        <button type="button" className="secondary" onClick={()=>choose(m)}>编辑</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{
          const x=await api<{latencyMs:number}>('/admin/ai/models/'+m.id+'/test',{method:'POST'});
          setNotice('连接成功，用时 '+x.latencyMs+' ms');
        })}>测试</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{
          if(!window.confirm('确定删除此模型配置？'))return;
          await api('/admin/ai/models/'+m.id,{method:'DELETE'});await reload();
        })}>删除</button>
      </div>
    </article>)}
    <h3>{editing?'编辑模型':'添加模型'}</h3>
    <form className="stack" onSubmit={save}>
      <label>配置名称<input required maxLength={100} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label>模型 ID<input required maxLength={150} value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></label>
      <label>API 地址（不包含 /responses 或 /chat/completions）<input required type="url" value={form.baseUrl} onChange={e=>setForm({...form,baseUrl:e.target.value})}/></label>
      <label>密钥（编辑留空即保留原密钥）<input type="password" autoComplete="new-password" value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})}/></label>
      <label>传输协议<select value={form.style} onChange={e=>setForm({...form,style:e.target.value as Model['style']})}>
        <option value="responses">Responses API</option>
        <option value="chat-completions">Chat Completions</option>
      </select></label>
      <label>推理强度<select value={form.reasoning} onChange={e=>setForm({...form,reasoning:e.target.value as Model['reasoning']})}>
        <option value="auto">由模型决定</option><option value="none">关闭（如支持）</option>
        <option value="low">低</option><option value="medium">中</option>
        <option value="high">高</option><option value="max">最大（如支持）</option>
      </select></label>
      <label>最大输出 Token<input type="number" min={512} max={131072} value={form.maxOutputTokens} onChange={e=>setForm({...form,maxOutputTokens:Number(e.target.value)})}/></label>
      <label>上下文字符预算<input type="number" min={2000} max={250000} value={form.contextChars} onChange={e=>setForm({...form,contextChars:Number(e.target.value)})}/></label>
      <label className="check"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked,isDefault:e.target.checked?form.isDefault:false})}/>启用此模型</label>
      <label className="check"><input type="checkbox" checked={form.isDefault} onChange={e=>setForm({...form,isDefault:e.target.checked,enabled:e.target.checked?true:form.enabled})}/>作为平台默认模型</label>
      <div className="actions"><button disabled={busy}>{editing?'保存修改':'添加模型'}</button>
        {editing&&<button type="button" className="secondary" onClick={()=>{setEditing(null);setForm(blank);}}>取消编辑</button>}
      </div>
    </form>
    {notice&&<p role="status" className="notice">{notice}</p>}
  </section>;
}
