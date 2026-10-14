'use client';
import { useEffect,useState,type FormEvent } from 'react';
import { json,request } from './client';

type Wire='responses'|'chat-completions';
type Reasoning='auto'|'none'|'low'|'medium'|'high'|'max';
type ReasoningFormat='none'|'responses-effort'|'chat-completions-effort';
type Provider={id:string;name:string;baseUrl:string;style:Wire;enabled:boolean;hasKey:boolean};
type Model={id:string;name:string;model:string;providerId:string;
  reasoning:Reasoning;reasoningFormat:ReasoningFormat;
  maxOutputTokens:number;contextChars:number;enabled:boolean;isDefault:boolean};
type ProviderForm={name:string;baseUrl:string;style:Wire;enabled:boolean;apiKey:string};
type ModelForm=Omit<Model,'id'>;
const newProvider=():ProviderForm=>({name:'',baseUrl:'',style:'chat-completions',enabled:false,apiKey:''});
const newModel=(providerId:string):ModelForm=>({name:'',model:'',providerId,
  reasoning:'auto',reasoningFormat:'none',maxOutputTokens:8192,contextChars:32768,
  enabled:false,isDefault:false});

export default function AdminModelPanel(){
  const [providers,setProviders]=useState<Provider[]>([]);
  const [models,setModels]=useState<Model[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [providerEditing,setProviderEditing]=useState<string|null>(null);
  const [modelEditing,setModelEditing]=useState<string|null>(null);
  const [providerForm,setProviderForm]=useState(newProvider);
  const [modelForm,setModelForm]=useState<ModelForm>(()=>newModel(''));
  const [panel,setPanel]=useState<'providers'|'models'>('providers');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');

  const refresh=async()=>{
    const [p,m]=await Promise.all([
      request<{providers:Provider[]}>('/admin/ai/providers'),
      request<{models:Model[]}>('/admin/ai/models'),
    ]);
    setProviders(p.providers);setModels(m.models);
    setSelected(old=>old&&p.providers.some(x=>x.id===old)?old:p.providers[0]?.id??null);
  };
  useEffect(()=>{void refresh().catch(e=>setNotice(e.message));},[]);
  const active=providers.find(x=>x.id===selected);
  const activeModels=models.filter(x=>x.providerId===selected);
  const run=async(work:()=>Promise<void>)=>{
    setBusy(true);setNotice('');
    try{await work();await refresh();}
    catch(e){setNotice(e instanceof Error?e.message:'操作失败');}
    finally{setBusy(false);}
  };
  const editProvider=(p:Provider)=>{
    setSelected(p.id);setProviderEditing(p.id);
    setModelEditing(null);setModelForm(newModel(p.id));
    setProviderForm({name:p.name,baseUrl:p.baseUrl,style:p.style,
      enabled:p.enabled,apiKey:''});
    setPanel('providers');
  };
  const addProvider=()=>{
    setProviderEditing(null);setProviderForm(newProvider());setPanel('providers');
  };
  const submitProvider=(e:FormEvent)=>{
    e.preventDefault();
    void run(async()=>{
      const result=await request<{provider:Provider}>(
        '/admin/ai/providers'+(providerEditing?'/'+providerEditing:''),
        {method:providerEditing?'PUT':'POST',body:json({...providerForm,
          apiKey:providerForm.apiKey||undefined})});
      setSelected(result.provider.id);
      setProviderEditing(null);setProviderForm(newProvider());setNotice('供应商连接已保存');
    });
  };
  const editModel=(m:Model)=>{
    setModelEditing(m.id);
    const {id,...rest}=m;
    setModelForm(rest);setPanel('models');
  };
  const addModel=()=>{
    setModelEditing(null);setModelForm(newModel(selected??''));setPanel('models');
  };
  const submitModel=(e:FormEvent)=>{
    e.preventDefault();
    void run(async()=>{
      await request('/admin/ai/models'+(modelEditing?'/'+modelEditing:''),
        {method:modelEditing?'PUT':'POST',body:json(modelForm)});
      setModelEditing(null);setModelForm(newModel(selected??''));setNotice('模型已保存');
    });
  };
  const requiredFormat=providers.find(p=>p.id===modelForm.providerId)?.style==='responses'
    ?'responses-effort':'chat-completions-effort';
  return <div className="management-layout">
    <header className="management-heading">
      <div><h2>AI 服务中心</h2><p className="hint">系统管理员维护供应商连接和可用模型，项目成员无需接触 API Key。</p></div>
      <button onClick={addProvider} type="button">＋ 添加供应商</button>
    </header>
    <div className="provider-workspace">
      <aside className="provider-list" aria-label="供应商连接">
        <h3>供应商连接 <span className="count">{providers.length}</span></h3>
        {providers.map(p=><button key={p.id} type="button"
          className={'provider-list-item '+(selected===p.id?'is-active':'')}
          onClick={()=>{setSelected(p.id);setPanel('providers');editProvider(p);}}>
          <span className="provider-avatar">{p.name.slice(0,1).toUpperCase()}</span>
          <span className="provider-list-text"><strong>{p.name}</strong>
            <small>{models.filter(m=>m.providerId===p.id).length} 个模型 · {p.enabled?'已启用':'已停用'}</small>
          </span></button>)}
        {!providers.length&&<p className="hint">暂无连接，先添加一个服务商或本地模型代理。</p>}
      </aside>
      <div className="provider-main">
        <div className="management-tabs">
          <button className={panel==='providers'?'active':''} onClick={()=>setPanel('providers')} type="button">连接设置</button>
          <button className={panel==='models'?'active':''} onClick={()=>{setPanel('models');if(!modelEditing)setModelForm(newModel(selected??''));}} type="button">模型列表 ({activeModels.length})</button>
        </div>
        {panel==='providers'&&<section className="management-editor">
          <div className="between"><h3>{providerEditing?'编辑供应商连接':'添加供应商连接'}</h3>
            {providerEditing&&<button type="button" className="secondary"
              onClick={addProvider}>新建连接</button>}
          </div>
          <form className="management-form" onSubmit={submitProvider}>
            <label>连接名称<input value={providerForm.name} maxLength={100} required
              placeholder="例如：公司 DeepSeek / 本地模型代理"
              onChange={e=>setProviderForm({...providerForm,name:e.target.value})}/></label>
            <label>API 请求基础地址<input type="url" required value={providerForm.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={e=>setProviderForm({...providerForm,baseUrl:e.target.value})}/>
              <small className="hint">这是模型 API 地址，不是服务商官网。系统会依据协议补充具体接口路径。</small>
            </label>
            <label>请求协议<select value={providerForm.style}
              onChange={e=>setProviderForm({...providerForm,style:e.target.value as Wire})}>
              <option value="chat-completions">Chat Completions（兼容接口）</option>
              <option value="responses">Responses API</option>
            </select><small className="hint">暂不支持 Anthropic Messages 等不同格式；请使用服务商已提供且经过测试的兼容接口。</small></label>
            <label>API Key（{providerEditing&&active?.hasKey?'已保存，留空保持不变':'尚未保存'}）
              <input type="password" autoComplete="new-password" value={providerForm.apiKey}
                placeholder={providerEditing&&active?.hasKey?'••••••••（留空保持）':'请输入服务端凭据'}
                onChange={e=>setProviderForm({...providerForm,apiKey:e.target.value})}/>
              <small className="hint">仅提交到服务端加密保存，编辑时不回显明文；请勿将 Key 放入 .env 的 LLM_* 字段。</small>
            </label>
            <label className="check"><input type="checkbox" checked={providerForm.enabled}
              onChange={e=>setProviderForm({...providerForm,enabled:e.target.checked})}/>启用该供应商连接</label>
            <div className="actions"><button disabled={busy} type="submit">保存连接</button>
              {providerEditing&&<button type="button" className="secondary" disabled={busy}
                onClick={()=>void run(async()=>{
                  if(!window.confirm('确定移除供应商？请先删除关联模型。'))return;
                  await request('/admin/ai/providers/'+providerEditing,{method:'DELETE'});
                  setSelected(null);setProviderEditing(null);setProviderForm(newProvider());
                })}>删除连接</button>}</div>
          </form>
          {providerEditing&&active&&<p className="hint">当前连接：{active.name} · {active.hasKey?'密钥已配置':'缺少密钥'}。
            系统仅显示密钥状态，不返回密钥内容。</p>}
        </section>}
        {panel==='models'&&<section className="management-editor">
          <div className="between"><h3>模型管理</h3>
            <button className="secondary" type="button" onClick={addModel} disabled={!selected}>＋ 添加模型</button>
          </div>
          {!selected&&<p className="hint">先创建供应商连接，再为该连接注册模型。</p>}
          {activeModels.map(m=><article className="model-card" key={m.id}>
            <div><strong>{m.name}</strong><p className="hint">{m.model} · {m.enabled?'已启用':'未启用'} {m.isDefault?'· 默认模型':''}</p></div>
            <div className="actions">
              <button className="secondary" type="button" onClick={()=>editModel(m)}>编辑</button>
              <button className="secondary" disabled={busy} type="button" onClick={()=>void run(async()=>{
                const result=await request<{latencyMs:number}>('/admin/ai/models/'+m.id+'/test',{method:'POST'});
                setNotice('测试通过 · '+result.latencyMs+' ms');
              })}>测试连接</button>
              <button className="secondary" disabled={busy} type="button" onClick={()=>void run(async()=>{
                if(!window.confirm('确定删除模型？'))return;
                await request('/admin/ai/models/'+m.id,{method:'DELETE'});
                setModelEditing(null);setModelForm(newModel(selected??''));
              })}>删除</button>
            </div>
          </article>)}
          {selected&&<form className="management-form" onSubmit={submitModel}>
            <h3>{modelEditing?'编辑模型':'注册模型'}</h3>
            <label>供应商连接<select required value={modelForm.providerId}
              onChange={e=>setModelForm({...modelForm,providerId:e.target.value,reasoningFormat:'none',reasoning:'auto'})}>
              <option value="">请选择连接</option>{providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <label>显示名称<input required maxLength={100} placeholder="例如：旗舰模型"
              value={modelForm.name} onChange={e=>setModelForm({...modelForm,name:e.target.value})}/></label>
            <label>实际请求模型 ID<input required maxLength={150} value={modelForm.model}
              placeholder="由供应商给出的 model 参数"
              onChange={e=>setModelForm({...modelForm,model:e.target.value})}/></label>
            <div className="management-grid">
              <label>最大输出 Token<input type="number" min={512} max={131072}
                value={modelForm.maxOutputTokens} onChange={e=>setModelForm({...modelForm,maxOutputTokens:Number(e.target.value)})}/></label>
              <label>输入预算（字符）<input type="number" min={2000} max={250000}
                value={modelForm.contextChars} onChange={e=>setModelForm({...modelForm,contextChars:Number(e.target.value)})}/></label>
            </div>
            <div className="management-grid">
              <label>推理参数支持<select value={modelForm.reasoningFormat}
                onChange={e=>setModelForm({...modelForm,reasoningFormat:e.target.value as ReasoningFormat,reasoning:'auto'})}>
                <option value="none">不发送推理参数</option>
                <option value={requiredFormat}>{requiredFormat==='responses-effort'?'Responses reasoning.effort':'Chat Completions reasoning_effort'}</option>
              </select></label>
              <label>推理等级<select value={modelForm.reasoning} disabled={modelForm.reasoningFormat==='none'}
                onChange={e=>setModelForm({...modelForm,reasoning:e.target.value as Reasoning})}>
                <option value="auto">默认</option><option value="none">关闭</option>
                <option value="low">低</option><option value="medium">中</option>
                <option value="high">高</option><option value="max">最大</option>
              </select></label>
            </div>
            <label className="check"><input type="checkbox" checked={modelForm.enabled}
              onChange={e=>setModelForm({...modelForm,enabled:e.target.checked,isDefault:e.target.checked?modelForm.isDefault:false})}/>启用模型</label>
            <label className="check"><input type="checkbox" checked={modelForm.isDefault}
              onChange={e=>setModelForm({...modelForm,isDefault:e.target.checked,enabled:e.target.checked||modelForm.enabled})}/>设置为平台默认模型</label>
            <div className="actions"><button disabled={busy} type="submit">{modelEditing?'保存修改':'添加模型'}</button>
              {modelEditing&&<button className="secondary" type="button" onClick={addModel}>取消编辑</button>}</div>
            <p className="hint">请求预算和推理映射须与实际模型能力相符；模型注册不等于已通过兼容性测试。</p>
          </form>}
        </section>}
      </div>
    </div>
    {notice&&<p role="status" className="notice">{notice}</p>}
  </div>;
}
