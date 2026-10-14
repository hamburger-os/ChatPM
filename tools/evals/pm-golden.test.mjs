import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyGoldenCorpus,evaluateCase,summarizeEvaluations } from './pm-golden-scorer.mjs';

const corpus=JSON.parse(readFileSync(new URL('./pm-golden.json',import.meta.url),'utf8'));
function compliant(c){
  return {items:c.expected.itemKinds.map(kind=>({
    kind,title:'合成事项',detail:'合成验证',assignee_hint:null,due_at:null,confidence:0.8,
  })),progress:c.expected.progressKinds.map((kind,i)=>({
    kind,task_id:c.expected.progressTaskIds[i],summary:'合成进度',
  }))};
}
test('golden corpus versions, coverage and explicit unsupported gaps',()=>{
  assert.deepEqual(verifyGoldenCorpus(corpus),{total:16,supported:10,unsupported:6});
});
test('offline evaluator checks invariants without claiming model quality',()=>{
  const scores=corpus.cases.map(c=>evaluateCase(c,c.supported?compliant(c):null));
  assert.deepEqual(summarizeEvaluations(scores),{
    supported:10,passed:10,failed:0,unsupported:6,observedPassRate:1,coverageRate:0.625,
  });
  assert.equal(scores.filter(x=>x.status==='unsupported').length,6);
});
test('rejects invented assignment and dates for ambiguous work',()=>{
  const c=corpus.cases.find(x=>x.id==='ambiguous-date');
  const r=compliant(c);r.items[0].due_at='2026-09-30T08:00:00Z';
  assert.ok(evaluateCase(c,r).violations.includes('HALLUCINATED_DEADLINE'));
  const t=corpus.cases.find(x=>x.id==='new-task');
  const s=compliant(t);s.items[0].assignee_hint='随意指派';
  assert.ok(evaluateCase(t,s).violations.includes('HALLUCINATED_ASSIGNEE'));
});
test('rejects unauthorized references and prompt-injection outputs',()=>{
  const c=corpus.cases.find(x=>x.id==='cross-project-reference');
  const r=compliant(c);r.progress.push({
    kind:'completion_claim',task_id:'22222222-2222-4222-8222-222222222222',summary:'注入',
  });
  const violations=evaluateCase(c,r).violations;
  assert.ok(violations.includes('CROSS_PROJECT_TASK_REFERENCE'));
  assert.ok(violations.includes('PROGRESS_KIND_MISMATCH'));
  const injection=corpus.cases.find(x=>x.id==='prompt-injection');
  const s=compliant(injection);s.items.push({
    kind:'task',title:'越权任务',detail:'',assignee_hint:null,due_at:null,confidence:0.5,
  });
  assert.ok(evaluateCase(injection,s).violations.includes('ITEM_KIND_MISMATCH'));
});
test('invalid provider outputs fail schema validation',()=>{
  const c=corpus.cases.find(x=>x.id==='task-progress');
  assert.deepEqual(evaluateCase(c,{items:[{kind:'made-up'}],progress:[]}).violations,['MODEL_SCHEMA']);
});
