'use client';
import { useEffect,useRef,useState,type FormEvent } from 'react';
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
type CatalogModel={id:string;name:string;ownedBy:string|null};
type Catalog={models:CatalogModel[];latencyMs:number;truncated:boolean};
type TestMode='quick'|'full';
type TestOutcome={ok:boolean;mode:TestMode;textOk:boolean|null;structuredOk:boolean;
  errorCode?:string;latencyMs:number;textLatencyMs?:number};
const testHelp:Record<string,string>={
  MODEL_HTTP_404:'接口不存在。检查基础地址是否遗漏 /v1，并确认所选协议和代理实际路由一致。',
  MODEL_HTTP_401:'密钥验证失败，请检查代理中的 API Key。',
  MODEL_HTTP_403:'代理拒绝了访问，请核对服务权限。',
  MODEL_HTTP_429:'触发了代理限流，请稍后重试。',
  MODEL_EMPTY_OUTPUT:'上游返回成功状态，但没有可读文本。请检查代理日志、模型 ID 和协议。',
  MODEL_REASONING_ONLY_OUTPUT:'响应中只有推理内容，没有最终答案。请检查模型推理设置或提高输出 Token 预算。',
  MODEL_RESPONSE_FORMAT_MISMATCH:'服务返回的响应结构与所选请求协议不一致。请尝试匹配的 Chat Completions 或 Responses 协议。',
  MODEL_INCOMPLETE_OUTPUT:'生成未完成或被截断，建议检查模型参数和输出 Token 上限。',
  MODEL_INVALID_JSON:'模型返回了文本但不是有效 JSON，暂不满足 ChatPM 的结构化输出要求。',
  MODEL_TEST_CONTENT_MISMATCH:'模型响应未包含预期的结构化测试字段。',
  MODEL_REFUSED:'模型拒绝了测试请求。',
  MODEL_INVALID_RESPONSE:'代理返回的内容不是符合要求的 JSON API 响应。',
};
const emptyProvider=():ProviderForm=>({name:'',baseUrl:'',style:'chat-completions',enabled:false,apiKey:''});
const fromProvider=(p:Provider):ProviderForm=>({name:p.name,baseUrl:p.baseUrl,style:p.style,
  enabled:p.enabled,apiKey:''});
const fromModel=(m:Model):ModelForm=>{const {id,...form}=m;return form;};
const wireName=(wire:Wire)=>wire==='responses'?'Responses API':'Chat Completions';
const errorMessage=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试';

export default function AdminModelPanel(){
  const [providers,setProviders]=useState<Provider[]>([]);
  const [models,setModels]=useState<Model[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [creating,setCreating]=useState(false);
  const [providerEditing,setProviderEditing]=useState(false);
  const [draft,setDraft]=useState<ProviderForm>(emptyProvider);
  const providerBaseline=useRef(JSON.stringify(emptyProvider()));
  const [tab,setTab]=useState<'connections'|'models'>('connections');
  const [editingModel,setEditingModel]=useState<string|null>(null);
  const [modelDraft,setModelDraft]=useState<ModelForm|null>(null);
  const modelBaseline=useRef('');
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [catalogError,setCatalogError]=useState('');
  const [query,setQuery]=useState('');
  const [checked,setChecked]=useState<Set<string>>(()=>new Set());
  const [manualId,setManualId]=useState('');
  const [manualName,setManualName]=useState('');
  const [showManual,setShowManual]=useState(false);
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [tested,setTested]=useState<Record<string,number>>({});
  const [testResults,setTestResults]=useState<Record<string,TestOutcome>>({});
  const nameInput=useRef<HTMLInputElement>(null);

  const refresh=async(initial=false)=>{
    const [p,m]=await Promise.all([
      request<{providers:Provider[]}>('/admin/ai/providers'),
      request<{models:Model[]}>('/admin/ai/models'),
    ]);
    setProviders(p.providers);setModels(m.models);
    if(initial&&p.providers[0]){
      setSelected(p.providers[0].id);
      const next=fromProvider(p.providers[0]);
      setDraft(next);providerBaseline.current=JSON.stringify(next);
    }else if(!initial){
      setSelected(current=>current&&p.providers.some(x=>x.id===current)?current:
        p.providers[0]?.id??null);
    }
  };
  useEffect(()=>{void refresh(true).catch(e=>setNotice(errorMessage(e)));},[]);
  useEffect(()=>{if(creating)nameInput.current?.focus();},[creating]);
  const active=providers.find(p=>p.id===selected);
  const activeModels=models.filter(m=>m.providerId===selected);
  const dirtyProvider=(creating||providerEditing)&&JSON.stringify(draft)!==providerBaseline.current;
  const dirtyModel=!!modelDraft&&JSON.stringify(modelDraft)!==modelBaseline.current;
  const confirmLeave=()=>!dirtyProvider&&!dirtyModel||
    window.confirm('当前有未保存的配置，确定放弃修改吗？');
  const resetCatalog=()=>{
    setCatalog(null);setCatalogError('');setChecked(new Set());
    setQuery('');setManualId('');setManualName('');setShowManual(false);
  };
  const choose=(p:Provider)=>{
    if(busy||!confirmLeave())return;
    setSelected(p.id);setCreating(false);setProviderEditing(false);
    const next=fromProvider(p);setDraft(next);
    providerBaseline.current=JSON.stringify(next);
    setEditingModel(null);setModelDraft(null);resetCatalog();setNotice('');
  };
  const startCreate=()=>{
    if(busy||!confirmLeave())return;
    setCreating(true);setSelected(null);setProviderEditing(true);
    setTab('connections');setDraft(emptyProvider());
    providerBaseline.current=JSON.stringify(emptyProvider());
    setEditingModel(null);setModelDraft(null);resetCatalog();setNotice('');
  };
  const cancelProvider=()=>{
    if(!confirmLeave())return;
    setCreating(false);setProviderEditing(false);
    const first=providers.find(p=>p.id===selected)??providers[0];
    if(first){setSelected(first.id);setDraft(fromProvider(first));}
    else{setSelected(null);setDraft(emptyProvider());}
  };
  const loadCatalog=async(id:string)=>{
    setCatalogError('');
    try{
      const result=await request<Catalog>('/admin/ai/providers/'+id+'/discover',{method:'POST'});
      setCatalog(result);
      const available=new Set(result.models.map(m=>m.id));
      setChecked(current=>new Set([...current].filter(id=>available.has(id))));
      return result;
    }catch(e){setCatalogError(errorMessage(e));return null;}
  };
  const discover=async()=>{
    if(!selected||busy)return;
    if(!confirmLeave())return;
    setTab('models');setProviderEditing(false);setEditingModel(null);setModelDraft(null);
    setBusy('discover');
    try{const result=await loadCatalog(selected);
      if(result)setNotice('成功获取 '+result.models.length+' 个模型，耗时 '+result.latencyMs+' ms');
    }finally{setBusy('');}
  };
  const saveProvider=async(e:FormEvent)=>{
    e.preventDefault();if(busy)return;
    setBusy('saveProvider');setNotice('');
    try{
      const result=await request<{provider:Provider}>(
        '/admin/ai/providers'+(creating?'':('/'+selected)),
        {method:creating?'POST':'PUT',
          body:json({...draft,apiKey:draft.apiKey||undefined})});
      const saved=result.provider;
      setSelected(saved.id);setCreating(false);setProviderEditing(false);
      const next=fromProvider(saved);setDraft(next);
      providerBaseline.current=JSON.stringify(next);
      resetCatalog();setTested({});setTestResults({});await refresh();
      setNotice('连接已保存，可获取模型目录并批量注册。');
      setTab('models');
      // Try discovery as the next step, but a missing /models endpoint never
      // invalidates the saved provider or prevents manual registration.
      const found=await loadCatalog(saved.id);
      if(found)setNotice('连接保存成功，已发现 '+found.models.length+' 个模型，请选择需要添加的模型。');
    }catch(e){setNotice(errorMessage(e));}
    finally{setBusy('');}
  };
  const deleteProvider=async()=>{
    if(!selected||busy||!window.confirm('确定删除此连接？必须先删除关联模型。'))return;
    setBusy('deleteProvider');setNotice('');
    try{
      await request('/admin/ai/providers/'+selected,{method:'DELETE'});
      setSelected(null);setProviderEditing(false);resetCatalog();
      await refresh();setNotice('连接已删除');
    }catch(e){setNotice(errorMessage(e));}
    finally{setBusy('');}
  };
  const importModels=async()=>{
    if(!selected||busy)return;
    const selectedCatalog=(catalog?.models??[]).filter(m=>checked.has(m.id))
      .map(m=>({id:m.id,name:m.name}));
    const typed=manualId.trim();
    if(typed&&(!selectedCatalog.some(m=>m.id===typed)))
      selectedCatalog.push({id:typed,name:manualName.trim()||typed.slice(0,100)});
    if(!selectedCatalog.length)return;
    if(selectedCatalog.length>50){setNotice('每次最多添加 50 个模型');return;}
    setBusy('import');setNotice('');
    try{
      const result=await request<{created:number;skipped:number}>('/admin/ai/models/import',
        {method:'POST',body:json({providerId:selected,models:selectedCatalog})});
      await refresh();setChecked(new Set());setManualId('');setManualName('');
      setNotice('已新增 '+result.created+' 个模型，跳过 '+result.skipped+
        ' 个重复项。新模型默认禁用，请先测试再启用。');
    }catch(e){setNotice(errorMessage(e));}
    finally{setBusy('');}
  };
  const saveModel=async(e:FormEvent)=>{
    e.preventDefault();if(!editingModel||!modelDraft||busy)return;
    setBusy('model');setNotice('');
    try{
      await request('/admin/ai/models/'+editingModel,{method:'PUT',body:json(modelDraft)});
      await refresh();setEditingModel(null);setModelDraft(null);
      setNotice('模型配置已保存；修改配置后应重新进行兼容性测试。');
      setTested(old=>{const next={...old};delete next[editingModel];return next;});
      setTestResults(old=>{const next={...old};delete next[editingModel];return next;});
    }catch(e){setNotice(errorMessage(e));}
    finally{setBusy('');}
  };
  const updateModel=async(m:Model,changes:Partial<ModelForm>)=>{
    if(busy)return;
    if((changes.isDefault||changes.enabled===true)&&!tested[m.id]&&
      !window.confirm('该模型尚未在本次会话中通过兼容性测试，确定仍要启用吗？'))return;
    if(changes.enabled===false&&m.isDefault){
      setNotice('请先设置另一个默认模型，再停用当前模型。');return;
    }
    setBusy('update:'+m.id);setNotice('');
    try{
      await request('/admin/ai/models/'+m.id,{method:'PUT',body:json({...fromModel(m),...changes})});
      await refresh();
      setNotice(changes.isDefault?'已切换平台默认模型':'模型状态已更新');
    }catch(e){setNotice(errorMessage(e));}
    finally{setBusy('');}
  };
  const testModel=async(m:Model,mode:TestMode)=>{
    if(busy)return;
    setBusy('test:'+m.id+':'+mode);setNotice('');
    try{
      const result=await request<TestOutcome>('/admin/ai/models/'+m.id+'/test',
        {method:'POST',body:json({mode})});
      setTestResults(old=>({...old,[m.id]:result}));
      if(result.ok){
        setTested(old=>({...old,[m.id]:Date.now()}));
        setNotice(m.name+'：'+(mode==='quick'?'快速测试':'完整诊断')+
          '通过，耗时 '+result.latencyMs+' ms。'+
          (mode==='quick'?'已验证真实结构化输出（一次可能计费的请求）。':
            '已验证基础文本和结构化输出（两次可能计费的请求）。'));
      }else{
        setTested(old=>{const next={...old};delete next[m.id];return next;});
        const stage=mode==='quick'?'结构化输出未通过':
          result.textOk?'基础调用通过，但结构化输出失败':'基础调用未通过';
        setNotice(m.name+'：'+stage+'（'+result.errorCode+'）。'+
          (testHelp[result.errorCode??'']??'请检查代理地址、协议及模型配置。'));
      }
    }catch(e){setNotice(m.name+'：'+errorMessage(e));}
    finally{setBusy('');}
  };
  const deleteModel=async(m:Model)=>{
    if(busy||!window.confirm(m.isDefault?
      '该模型是平台默认模型，删除后 AI 功能将不可用，直到重新设置默认模型。确定删除吗？':
      '确定删除模型 '+m.name+'？'))return;
    setBusy('delete:'+m.id);setNotice('');
    try{
      await request('/admin/ai/models/'+m.id,{method:'DELETE'});
      await refresh();setEditingModel(null);setModelDraft(null);setNotice('模型已删除');
    }catch(e){setNotice(errorMessage(e));}
    finally{setBusy('');}
  };
  const registered=new Set(activeModels.map(m=>m.model));
  const filtered=(catalog?.models??[]).filter(m=>
    (m.id+' '+m.name).toLowerCase().includes(query.trim().toLowerCase()));
  const selectable=filtered.filter(m=>!registered.has(m.id));
  const selectedCount=checked.size+(manualId.trim()&&!checked.has(manualId.trim())?1:0);
  return <div className="management-layout">
    <header className="management-heading">
      <div><h2>AI 服务中心</h2>
        <p className="hint">仅系统管理员维护模型连接。项目成员无需管理密钥。{models.find(m=>m.isDefault)?
          '当前默认模型：'+models.find(m=>m.isDefault)?.name:' 尚未设置平台默认模型。'}</p></div>
      <button type="button" onClick={startCreate} disabled={!!busy}>＋ 添加连接</button>
    </header>
    {notice&&<p className="notice" role="status">{notice}</p>}
    <div className="provider-workspace">
      <aside className="provider-list" aria-label="供应商连接">
        <h3>供应商连接 <span className="count">{providers.length}</span></h3>
        {providers.map(p=><button key={p.id} type="button"
          className={'provider-list-item '+(selected===p.id?'is-active':'')}
          onClick={()=>choose(p)}>
          <span className="provider-avatar">{p.name.slice(0,1).toUpperCase()}</span>
          <span className="provider-list-text"><strong>{p.name}</strong>
            <small>{models.filter(m=>m.providerId===p.id).length} 个模型 ·
              {p.enabled?' 已启用':' 未启用'} · {p.hasKey?'已配置密钥':'缺少密钥'}</small></span>
        </button>)}
        {creating&&<p className="provider-create-indicator">＋ 新建连接（未保存）</p>}
        {!providers.length&&!creating&&<p className="hint">暂无连接，先创建一个模型服务连接。</p>}
      </aside>
      <main className="provider-main">
        <div className="management-tabs">
          <button type="button" className={tab==='connections'?'active':''}
            onClick={()=>{if(busy||!confirmLeave())return;setTab('connections');setEditingModel(null);setModelDraft(null);}}>
            连接设置</button>
          <button type="button" className={tab==='models'?'active':''} disabled={creating||!selected}
            onClick={()=>{if(busy||!confirmLeave())return;setTab('models');setProviderEditing(false);
              setEditingModel(null);setModelDraft(null);}}>
            模型管理 ({activeModels.length})</button>
        </div>
        {tab==='connections'&&<section className="management-editor">
          {!creating&&!providerEditing&&active&&<>
            <div className="between"><h3>{active.name}</h3>
              <span className="status-chip">{active.enabled?'已启用':'未启用'}</span></div>
            <dl className="provider-summary">
              <div><dt>API 地址</dt><dd>{active.baseUrl}</dd></div>
              <div><dt>请求协议</dt><dd>{wireName(active.style)}</dd></div>
              <div><dt>API Key</dt><dd>{active.hasKey?'已保存（不可回显）':'尚未设置'}</dd></div>
              <div><dt>已注册模型</dt><dd>{activeModels.length} 个</dd></div>
            </dl>
            <p className="hint">“已启用”仅表示配置开关状态，不代表推理已经通过测试。</p>
            <div className="actions">
              <button type="button" disabled={!!busy} onClick={()=>{setProviderEditing(true);
                const next=fromProvider(active);setDraft(next);providerBaseline.current=JSON.stringify(next);}}>
                编辑连接</button>
              <button type="button" className="secondary" disabled={!!busy} onClick={()=>void discover()}>
                检测连接并获取模型</button>
              <button type="button" className="secondary" disabled={!!busy}
                onClick={()=>{setTab('models');}}>管理模型</button>
            </div>
          </>}
          {(creating||providerEditing)&&<>
            <div className="between"><h3>{creating?'创建供应商连接':'编辑供应商连接'}</h3>
              <button type="button" className="secondary" onClick={cancelProvider} disabled={!!busy}>取消</button>
            </div>
            <form className="management-form" onSubmit={e=>void saveProvider(e)}>
              <label>连接名称<input ref={nameInput} required maxLength={100} value={draft.name}
                placeholder="例如：公司模型代理"
                onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
              <label>API 请求基础地址<input required type="url" value={draft.baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={e=>setDraft({...draft,baseUrl:e.target.value})}/>
                <small className="hint">填写 API 前缀，ChatPM 会在末尾添加 /models、/chat/completions 或 /responses。OpenAI 风格代理通常需要以 /v1 结尾，例如 http://127.0.0.1:8045/v1。</small>
                {/^(http:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(draft.baseUrl)&&
                  <small className="hint">本机地址属于 ChatPM 服务器或容器，不一定是浏览器所在电脑。</small>}
              </label>
              <label>请求协议<select value={draft.style}
                onChange={e=>setDraft({...draft,style:e.target.value as Wire})}>
                <option value="chat-completions">Chat Completions</option>
                <option value="responses">Responses API</option>
              </select></label>
              <label>API Key（{active?.hasKey&&!creating?'已保存，留空不修改':'尚未设置'}）
                <input type="password" autoComplete="new-password" value={draft.apiKey}
                  placeholder={active?.hasKey&&!creating?'留空保持现有密钥':'输入服务端 API Key'}
                  onChange={e=>setDraft({...draft,apiKey:e.target.value})}/>
                <small className="hint">密钥仅提交到服务端加密保存，不回传明文。</small>
              </label>
              <label className="check"><input type="checkbox" checked={draft.enabled}
                onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>启用此连接</label>
              <div className="actions"><button type="submit" disabled={!!busy}>
                {busy==='saveProvider'?'正在保存…':'保存并获取模型'}</button>
                {!creating&&<button type="button" className="secondary" disabled={!!busy}
                  onClick={()=>void deleteProvider()}>删除连接</button>}
              </div>
            </form>
          </>}
          {!active&&!creating&&<p className="hint">请选择连接或点击“添加连接”。</p>}
        </section>}
        {tab==='models'&&<section className="management-editor">
          <div className="between">
            <div><h3>模型管理</h3><p className="hint">添加模型默认不启用。快速测试只进行一次结构化 JSON 推理；遇到兼容问题时使用完整诊断（两次调用）。</p></div>
            <button type="button" className="secondary" disabled={!!busy||!selected}
              onClick={()=>void discover()}>{busy==='discover'?'正在获取…':'↻ 刷新模型列表'}</button>
          </div>
          <div className="catalog-box">
            <div className="between"><strong>从远端模型目录选择</strong>
              <span className="hint">{catalog?'发现 '+catalog.models.length+' 个':'尚未加载目录'}</span></div>
            {catalogError&&<p className="catalog-error" role="alert">{catalogError}
              <span className="hint">{catalog?'已保留上次成功获取的模型列表和选择，重试即可更新。':'仍可手动填写模型 ID。'}</span></p>}
            {catalog&&<>
              <label className="catalog-search">搜索模型（按名称或 ID）
                <input value={query} onChange={e=>setQuery(e.target.value)}
                  placeholder="筛选可用模型…"/></label>
              <div className="catalog-options" aria-label="发现的模型">
                {filtered.map(m=><label className="catalog-option" key={m.id}>
                  <input type="checkbox" disabled={registered.has(m.id)||!!busy}
                    checked={checked.has(m.id)} onChange={e=>setChecked(previous=>{
                      const next=new Set(previous);if(e.target.checked)next.add(m.id);else next.delete(m.id);
                      return next;})}/>
                  <span><strong>{m.name}</strong><small>{m.id}{m.ownedBy?' · '+m.ownedBy:''}</small></span>
                  {registered.has(m.id)&&<em>已注册</em>}
                </label>)}
                {!filtered.length&&<p className="hint">没有匹配的模型，请尝试手动注册。</p>}
              </div>
              <div className="catalog-actions">
                <button type="button" className="secondary" disabled={!selectable.length||!!busy}
                  onClick={()=>setChecked(new Set(selectable.map(m=>m.id)))}>
                  全选当前结果</button>
                <button type="button" className="secondary" disabled={!checked.size||!!busy}
                  onClick={()=>setChecked(new Set())}>清空选择</button>
                <span className="hint">{catalog.truncated?'目录部分结果已截断；':''}目录不保证模型支持结构化输出。</span>
              </div>
            </>}
            <button type="button" className="manual-toggle" aria-expanded={showManual}
              onClick={()=>setShowManual(x=>!x)}>
              {showManual?'−':'＋'} 手动注册模型（目录不可用时使用）
            </button>
            {showManual&&<div className="manual-fields">
              <label>实际请求模型 ID<input maxLength={150} value={manualId}
                onChange={e=>setManualId(e.target.value)} placeholder="供应商的 model 参数"/></label>
              <label>显示名称（可选）<input maxLength={100} value={manualName}
                onChange={e=>setManualName(e.target.value)} placeholder="例如：项目管理模型"/></label>
            </div>}
            <div className="actions">
              <button type="button" disabled={!selectedCount||!!busy||selectedCount>50}
                onClick={()=>void importModels()}>{busy==='import'?'正在添加…':
                '添加选中的 '+selectedCount+' 个模型'}</button>
              {selectedCount>50&&<small className="hint">每批最多导入 50 个模型</small>}
            </div>
          </div>
          <h3>已注册模型（{activeModels.length}）</h3>
          {activeModels.length===0&&<p className="hint">尚未注册模型。获取目录后勾选模型，或手动填写模型 ID。</p>}
          {activeModels.map(m=><article className="model-card" key={m.id}>
            <div className="model-card-info">
              <strong>{m.name}</strong><p className="hint">{m.model}</p>
              <p className="hint">{m.enabled?'已启用':'未启用'}{m.isDefault?' · 平台默认':''}
                {tested[m.id]?' · 本次会话结构化测试通过':''}</p>
              {testResults[m.id]&&<p className="hint" role="status">
                {testResults[m.id].mode==='quick'?'快速测试':'完整诊断'} · 基础文本：{testResults[m.id].textOk===null?'未单独测试':
                  testResults[m.id].textOk?'通过':'未通过'} · 结构化 JSON：
                {testResults[m.id].structuredOk?'通过':
                  testResults[m.id].mode==='full'&&!testResults[m.id].textOk?'未测试':'未通过'}
                {testResults[m.id].errorCode?' · '+testResults[m.id].errorCode:''}
                {testResults[m.id].errorCode&&<span> — {testHelp[testResults[m.id].errorCode??'']??'请检查模型设置。'}</span>}
              </p>}
            </div>
            <div className="actions">
              <button type="button" className="secondary" disabled={!!busy}
                onClick={()=>void testModel(m,'quick')}>
                {busy==='test:'+m.id+':quick'?'测试中…':'快速测试'}</button>
              <button type="button" className="secondary" disabled={!!busy}
                onClick={()=>void testModel(m,'full')}>
                {busy==='test:'+m.id+':full'?'诊断中…':'完整诊断'}</button>
              <button type="button" className="secondary" disabled={!!busy}
                onClick={()=>{if(busy||!confirmLeave())return;setEditingModel(m.id);
                  const next=fromModel(m);setModelDraft(next);
                  modelBaseline.current=JSON.stringify(next);}}>高级设置</button>
              <button type="button" className="secondary" disabled={!!busy||m.isDefault}
                onClick={()=>void updateModel(m,{enabled:!m.enabled})}>{m.enabled?'停用':'启用'}</button>
              {!m.isDefault&&<button type="button" className="secondary" disabled={!!busy}
                onClick={()=>void updateModel(m,{isDefault:true,enabled:true})}>设为默认</button>}
              <button type="button" className="secondary" disabled={!!busy}
                onClick={()=>void deleteModel(m)}>删除</button>
            </div>
          </article>)}
          {editingModel&&modelDraft&&<form className="management-form model-advanced"
            onSubmit={e=>void saveModel(e)}>
            <div className="between"><h3>高级设置：{models.find(m=>m.id===editingModel)?.name}</h3>
              <button type="button" className="secondary" onClick={()=>{
                if(!confirmLeave())return;setEditingModel(null);setModelDraft(null);}}>取消</button></div>
            <label>显示名称<input required maxLength={100} value={modelDraft.name}
              onChange={e=>setModelDraft({...modelDraft,name:e.target.value})}/></label>
            <label>实际请求模型 ID<input required maxLength={150} value={modelDraft.model}
              onChange={e=>setModelDraft({...modelDraft,model:e.target.value})}/></label>
            <div className="management-grid">
              <label>最大输出 Token 预算<input type="number" min={512} max={131072}
                value={modelDraft.maxOutputTokens}
                onChange={e=>setModelDraft({...modelDraft,maxOutputTokens:Number(e.target.value)})}/></label>
              <label>项目上下文字符截取预算<input type="number" min={2000} max={250000}
                value={modelDraft.contextChars}
                onChange={e=>setModelDraft({...modelDraft,contextChars:Number(e.target.value)})}/></label>
            </div>
            <p className="hint">以上是 ChatPM 的请求预算，不代表模型实际最大上下文窗口。</p>
            <div className="management-grid">
              <label>推理参数映射<select value={modelDraft.reasoningFormat}
                onChange={e=>setModelDraft({...modelDraft,reasoningFormat:e.target.value as ReasoningFormat,
                  reasoning:'auto'})}>
                <option value="none">不发送推理参数（推荐）</option>
                <option value={active?.style==='responses'?'responses-effort':'chat-completions-effort'}>
                  {active?.style==='responses'?'Responses reasoning.effort':'Chat reasoning_effort'}</option>
              </select></label>
              <label>推理等级<select disabled={modelDraft.reasoningFormat==='none'}
                value={modelDraft.reasoning}
                onChange={e=>setModelDraft({...modelDraft,reasoning:e.target.value as Reasoning})}>
                <option value="auto">由模型决定</option><option value="none">关闭</option>
                <option value="low">低</option><option value="medium">中</option>
                <option value="high">高</option><option value="max">最大</option>
              </select></label>
            </div>
            <p className="hint">仅在供应商明确支持时发送推理等级；保存后重新执行模型测试。</p>
            <button type="submit" disabled={!!busy}>保存模型配置</button>
          </form>}
        </section>}
      </main>
    </div>
  </div>;
}
