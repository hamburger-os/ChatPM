export type User={id:string,email:string,display_name:string,is_system_admin:boolean};
export type Tenant={id:string,name:string,role:'admin'|'member'};
export type Role='owner'|'manager'|'member'|'observer';
export type Project={id:string,name:string,role:Role,ai_enabled:boolean,
  timezone:string,work_start:number|null,work_end:number|null,cooldown_hours:number|null,
  settings_revision:number};
export type Person={id:string,display_name:string,email:string,role:Role};
export type Message={id:string,seq:number,kind:string,content:string,author:string|null,
  author_id?:string|null,created_at:string,client_nonce?:string};
export type Task={id:string,title:string,detail:string,status:string,version:number,
  assignee:string|null,assignee_id:string|null,due_date:string|null};
export type Proposal={id:string,kind:'task'|'risk',status:string,title:string,detail:string,
  assignee_hint:string|null,due_at:string|null,clarified_due_at:string|null,
  evidence_text?:string,model_name?:string};
export type Progress={id:string,task_id:string,task_title:string,status:string,
  kind:string,summary:string,created_at:string};
export type Report={id:string,kind:'week'|'month',period_key:string,state:string,
  revision:number,content:string,published_at?:string|null,published_by?:string|null};
export type Risk={id:string,title:string,detail:string,
  status:'open'|'mitigating'|'resolved',version:number,
  likelihood:number|null,impact:number|null,owner_id:string|null,
  response_plan:string};

export async function request<T>(path:string,options?:RequestInit):Promise<T>{
  const response=await fetch('/api'+path,{...options,credentials:'include',cache:'no-store',
    headers:{...(options?.body?{'Content-Type':'application/json'}:{}),...options?.headers}});
  const result=await response.json().catch(()=>({error:'服务暂时不可用'}));
  if(!response.ok)throw Object.assign(new Error(result.error||'请求失败'),{status:response.status});
  return result as T;
}
export const json=(value:unknown)=>JSON.stringify(value);
