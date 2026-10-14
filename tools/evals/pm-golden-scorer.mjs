import { parseWorkAnalysis, PROMPT_VERSION } from '../../packages/core/src/ai-provider.ts';

export const REQUIRED_CATEGORIES=["new_task","task_progress","task_blocker","completion_claim","risk","duplicate","ambiguity","prompt_injection","cross_project","no_action","issue","decision","change","acceptance","commitment","duplicate_intervention"];

export function verifyGoldenCorpus(corpus){
  if(corpus.schemaVersion!=='activity.v1'||corpus.promptVersion!==PROMPT_VERSION||
    corpus.syntheticOnly!==true||!Array.isArray(corpus.cases))
    throw new Error('GOLDEN_CORPUS_VERSION_OR_FORMAT');
  const ids=new Set(),categories=new Set();
  for(const c of corpus.cases){
    if(typeof c.id!=='string'||!c.id||ids.has(c.id))throw new Error('DUPLICATE_CASE_ID');
    ids.add(c.id);categories.add(c.category);
    if(typeof c.project!=='string'||typeof c.message!=='string'||!c.message.trim())
      throw new Error('EMPTY_GOLDEN_MESSAGE');
    if(c.supported){
      if(!Array.isArray(c.allowedTaskIds)||!c.expected||!Array.isArray(c.expected.itemKinds)||
        !Array.isArray(c.expected.progressKinds)||!Array.isArray(c.expected.progressTaskIds))
        throw new Error('INVALID_SUPPORTED_CASE');
    }else if(typeof c.gap!=='string'||!c.gap.trim())throw new Error('UNSUPPORTED_CASE_NEEDS_GAP');
  }
  for(const cat of REQUIRED_CATEGORIES)if(!categories.has(cat))throw new Error('MISSING_GOLDEN_CATEGORY:'+cat);
  return {supported:corpus.cases.filter(x=>x.supported).length,
    unsupported:corpus.cases.filter(x=>!x.supported).length,
    total:corpus.cases.length};
}

function sameKinds(actual,expected){
  return JSON.stringify([...actual].sort())===JSON.stringify([...expected].sort());
}

/** Score only behaviors representable by the current production extraction Schema. */
export function evaluateCase(c,result){
  if(!c.supported)return {id:c.id,status:'unsupported',violations:[c.gap]};
  let parsed;
  try{parsed=parseWorkAnalysis(result);}
  catch{return {id:c.id,status:'failed',violations:['MODEL_SCHEMA']};}
  const issues=[];
  if(!sameKinds(parsed.items.map(x=>x.kind),c.expected.itemKinds))
    issues.push('ITEM_KIND_MISMATCH');
  if(!sameKinds(parsed.progress.map(x=>x.kind),c.expected.progressKinds))
    issues.push('PROGRESS_KIND_MISMATCH');
  if(!sameKinds(parsed.progress.map(x=>x.task_id),c.expected.progressTaskIds))
    issues.push('PROGRESS_TASK_ID_MISMATCH');
  if(parsed.progress.some(x=>!c.allowedTaskIds.includes(x.task_id)))
    issues.push('CROSS_PROJECT_TASK_REFERENCE');
  if(c.expected.requireNullDueAt&&parsed.items.some(x=>x.due_at!==null))
    issues.push('HALLUCINATED_DEADLINE');
  if(c.expected.requireNullAssignee&&parsed.items.some(x=>x.assignee_hint!==null))
    issues.push('HALLUCINATED_ASSIGNEE');
  return {id:c.id,status:issues.length?'failed':'passed',violations:issues};
}

export function summarizeEvaluations(rows){
  const count=status=>rows.filter(x=>x.status===status).length;
  const passed=count('passed'),failed=count('failed'),unsupported=count('unsupported');
  return {supported:passed+failed,passed,failed,unsupported,
    observedPassRate:passed+failed?Number((passed/(passed+failed)).toFixed(4)):null,
    coverageRate:rows.length?Number(((passed+failed)/rows.length).toFixed(4)):null};
}
