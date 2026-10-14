import { readFileSync } from 'node:fs';
import { readLLMSettings,callStructuredLLM,modelAuditIdentity } from '../../packages/core/src/llm-transport.ts';
import { ACTIVITY_SCHEMA,buildActivityPrompt } from '../../packages/core/src/ai-provider.ts';
import { verifyGoldenCorpus,evaluateCase,summarizeEvaluations } from './pm-golden-scorer.mjs';

// Explicitly opt in: every supported case can incur one real provider call.
// Use synthetic fixtures only. Never print model output, chat content or credentials.
if(process.env.PM_EVAL_LIVE!=='1'){
  console.error('Live evaluation disabled. Set PM_EVAL_LIVE=1 and trusted LLM_* settings.');
  process.exitCode=2;
}else{
  try{
    const cfg=readLLMSettings(process.env);
    const corpus=JSON.parse(readFileSync(new URL('./pm-golden.json',import.meta.url),'utf8'));
    verifyGoldenCorpus(corpus);
    const results=[];
    for(const c of corpus.cases){
      if(!c.supported){results.push(evaluateCase(c,null));continue;}
      try{
        const value=await callStructuredLLM(cfg,buildActivityPrompt(c.project,c.message),ACTIVITY_SCHEMA);
        results.push(evaluateCase(c,value));
      }catch{
        results.push({id:c.id,status:'failed',violations:['MODEL_REQUEST_OR_SCHEMA_FAILURE']});
      }
    }
    const summary=summarizeEvaluations(results);
    console.log(JSON.stringify({model:modelAuditIdentity(cfg),promptVersion:corpus.promptVersion,
      datasetVersion:corpus.schemaVersion,summary,
      cases:results.map(r=>({id:r.id,status:r.status,violations:r.violations}))},null,2));
    if(summary.failed>0)process.exitCode=1;
  }catch(error){
    console.error(error instanceof Error && /^MODEL_[A-Z0-9_]+$/.test(error.message)
      ?error.message:'PM_GOLDEN_EVAL_FAILED');
    process.exitCode=1;
  }
}
