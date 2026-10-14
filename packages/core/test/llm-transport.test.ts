import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callStructuredLLM, probeModelText, readLLMSettings, modelAuditIdentity } from '../src/llm-transport.ts';

const schema={type:'object',additionalProperties:false,required:['items'],
  properties:{items:{type:'array',items:{type:'string'}}}};
const json=JSON.stringify({items:['task']});
const settings=(extra:Record<string,string>={})=>readLLMSettings({
  LLM_API_KEY:'private-test-key',LLM_BASE_URL:'https://api.openai.com/v1',
  LLM_MODEL:'gpt-4.1-mini',LLM_API_STYLE:'responses',...extra,
});

test('explicit Responses configuration keeps private key only in request header',async()=>{
  const got:string[]=[];
  const mocked:typeof fetch=async(input,init)=>{
    got.push(String(input));
    assert.equal(init?.redirect,'error');
    const body=JSON.parse(String(init?.body));
    assert.equal(body.text.format.type,'json_schema');
    assert.equal(body.text.format.strict,true);
    assert.equal(body.model,'gpt-4.1-mini');
    assert.ok(body.input[0].content.includes('不可信'));
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer private-test-key');
    assert.equal(JSON.stringify(body).includes('private-test-key'),false);
    return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:json}]}]}),{status:200});
  };
  assert.deepEqual(await callStructuredLLM(settings(), 'please extract',schema,mocked),{items:['task']});
  assert.deepEqual(got,['https://api.openai.com/v1/responses']);
});

test('DeepSeek Responses uses the configured host and model',async()=>{
  const config=settings({LLM_BASE_URL:'https://api.deepseek.com/',LLM_MODEL:'deepseek-flash'});
  assert.equal(config.baseUrl,'https://api.deepseek.com');
  const mocked:typeof fetch=async(input,init)=>{
    assert.equal(String(input),'https://api.deepseek.com/responses');
    assert.equal(JSON.parse(String(init?.body)).model,'deepseek-flash');
    return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:json}]}]}),{status:200});
  };
  assert.deepEqual(await callStructuredLLM(config,'msg',schema,mocked),{items:['task']});
});

test('chat completions selects json_object and requires a complete response',async()=>{
  const config=settings({LLM_API_STYLE:'chat-completions',
    LLM_BASE_URL:'http://127.0.0.1:11434/v1',LLM_MODEL:'local-model'});
  const mocked:typeof fetch=async(input,init)=>{
    assert.equal(String(input),'http://127.0.0.1:11434/v1/chat/completions');
    const body=JSON.parse(String(init?.body));
    assert.equal(body.response_format.type,'json_object');
    assert.ok(body.messages[0].content.includes('JSON Schema'));
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:json}}]}),{status:200});
  };
  assert.deepEqual(await callStructuredLLM(config,'msg',schema,mocked),{items:['task']});
});

test('fail closed on missing key, protocol downgrade, malformed endpoints and invalid styles',()=>{
  for(const env of [
    {LLM_API_KEY:''},
    {LLM_API_KEY:'test',LLM_BASE_URL:'http://api.deepseek.com'},
    {LLM_API_KEY:'test',LLM_BASE_URL:'https://user:pass@example.com/v1'},
    {LLM_API_KEY:'test',LLM_BASE_URL:'https://example.com/v1?secret=1'},
    {LLM_API_KEY:'test',LLM_BASE_URL:'https://api.openai.com/v1/responses'},
    {LLM_API_KEY:'test',LLM_API_STYLE:'invalid'},
  ])assert.throws(()=>readLLMSettings(env));
});
test('rejects upstream errors, incomplete responses, refusals, empty and non-JSON output',async()=>{
  const config=settings();
  const responses=[
    new Response('do not print upstream secret',{status:401}),
    new Response(JSON.stringify({status:'incomplete',output:[]}),{status:200}),
    new Response(JSON.stringify({status:'completed',output:[]}),{status:200}),
    new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:'{bad'}]}]}),{status:200}),
  ];
  for(const response of responses){
    await assert.rejects(callStructuredLLM(config,'msg',schema,async()=>response),error=>{
      assert.equal(String(error).includes('upstream secret'),false);return true;
    });
  }
  const chat=settings({LLM_API_STYLE:'chat-completions'});
  await assert.rejects(callStructuredLLM(chat,'msg',schema,async()=>new Response(
    JSON.stringify({choices:[{finish_reason:'length',message:{content:json}}]}),{status:200}
  )),/MODEL_INCOMPLETE_OUTPUT/);
  await assert.rejects(callStructuredLLM(chat,'msg',schema,async()=>new Response(
    JSON.stringify({choices:[{finish_reason:'stop',message:{content:json,refusal:'no'}}]}),{status:200}
  )),/MODEL_REFUSED/);
});

test('audit identity distinguishes endpoints without exposing credentials or private URL paths',()=>{
  const a=settings({LLM_BASE_URL:'https://api.deepseek.com/v1/proxy-private-segment',
    LLM_MODEL:'same-model'});
  const b=settings({LLM_BASE_URL:'https://api.deepseek.com/v2',
    LLM_MODEL:'same-model'});
  const c=settings({LLM_BASE_URL:'https://api.deepseek.com/v2',
    LLM_MODEL:'same-model',LLM_API_STYLE:'chat-completions'});
  const names=[a,b,c].map(modelAuditIdentity);
  assert.equal(new Set(names).size,3);
  assert.equal(names[0].split(' ')[1], '@api.deepseek.com');
  assert.ok(names.every(n=>!n.includes('private-test-key')&&!n.includes('proxy-private-segment')));
});

test('fetch explicitly forbids redirecting POST chat contents and model keys',async()=>{
  const mocked:typeof fetch=async (_input,init)=>{
    assert.equal(init?.redirect,'error');
    // Real fetch will reject a redirect in this mode. Simulate that failure.
    throw new TypeError('redirect mode is set to error');
  };
  await assert.rejects(callStructuredLLM(settings(),'sensitive project text',schema,mocked),TypeError);
});

test('read-only PM replies use a separate system role and respect configured budgets',async()=>{
  const config={...settings(),maxOutputTokens:900,contextChars:2000,reasoning:'high' as const,reasoningFormat:'responses-effort' as const};
  const data=await callStructuredLLM(config,'project status',schema,async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.max_output_tokens,900);
    assert.equal(body.reasoning.effort,'high');
    assert.ok(body.input[0].content.includes('AI 项目经理助手'));
    assert.equal(body.input[0].content.includes('项目记录抽取器'),false);
    return new Response(JSON.stringify({status:'completed',
      output:[{content:[{type:'output_text',text:json}]}]}),{status:200});
  },'reply');
  assert.deepEqual(data,{items:['task']});
});

test('DeepSeek Responses uses selected reasoning and output budget',async()=>{
  const cfg={...settings({LLM_BASE_URL:'https://api.deepseek.com'}),
    reasoning:'max' as const,reasoningFormat:'responses-effort' as const,maxOutputTokens:16000,contextChars:45000};
  const result=await callStructuredLLM(cfg,'short request',schema,async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.reasoning.effort,'max');
    assert.equal(body.max_output_tokens,16000);
    return new Response(JSON.stringify({status:'completed',
      output:[{content:[{type:'output_text',text:json}]}]}),{status:200});
  });
  assert.deepEqual(result,{items:['task']});
});
test('chat-completions respects configured context instead of hidden 6500-character cap',async()=>{
  const cfg={...settings({LLM_BASE_URL:'https://api.deepseek.com',
      LLM_API_STYLE:'chat-completions'}),contextChars:11000,
    reasoning:'high' as const,reasoningFormat:'chat-completions-effort' as const};
  await callStructuredLLM(cfg,'x'.repeat(9500),schema,async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.messages[1].content.length,9500);
    assert.equal(body.reasoning_effort,'high');
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',
      message:{content:json}}]}),{status:200});
  });
});

test('reasoning is declared by the model, never inferred from endpoint brand',async()=>{
  const config={...settings({LLM_BASE_URL:'https://model-gateway.example/v1'}),
    reasoning:'high' as const,reasoningFormat:'responses-effort' as const};
  await callStructuredLLM(config,'task',schema,async(_input,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.reasoning.effort,'high');
    return new Response(JSON.stringify({status:'completed',
      output:[{content:[{type:'output_text',text:json}]}]}),{status:200});
  });
  await assert.rejects(callStructuredLLM({...config,reasoningFormat:'none'},'task',schema),
    /MODEL_REASONING_UNSUPPORTED/);
});


test('proxy plain-text probe omits strict JSON options and uses configured prefix',async()=>{
  const config=settings({LLM_API_STYLE:'chat-completions',
    LLM_BASE_URL:'http://127.0.0.1:8045/v1',LLM_MODEL:'gemini-example-high'});
  const result=await probeModelText(config,async(url,init)=>{
    assert.equal(String(url),'http://127.0.0.1:8045/v1/chat/completions');
    const body=JSON.parse(String(init?.body));
    assert.equal(body.model,'gemini-example-high');
    assert.equal(body.response_format,undefined);
    assert.equal(body.reasoning_effort,undefined);
    assert.equal(body.messages.length,1);
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',
      message:{content:'OK'}}]}),{status:200});
  });
  assert.equal(result,'OK');
});

test('proxy Responses adapter accepts nonstandard visible string content without reading reasoning data',async()=>{
  const content=JSON.stringify({items:['done']});
  const config=settings();
  const result=await callStructuredLLM(config,'test',schema,async()=>new Response(
    JSON.stringify({status:'completed',output:[
      {type:'reasoning',content:'private reasoning must not be exposed'},
      {type:'message',role:'assistant',content},
    ]}),{status:200}));
  assert.deepEqual(result,{items:['done']});
});

test('Responses adapter distinguishes reasoning-only and other wire envelope',async()=>{
  const config=settings();
  await assert.rejects(callStructuredLLM(config,'test',schema,async()=>new Response(
    JSON.stringify({status:'completed',output:[{type:'reasoning',content:[]}]})
  )),/MODEL_REASONING_ONLY_OUTPUT/);
  await assert.rejects(callStructuredLLM(config,'test',schema,async()=>new Response(
    JSON.stringify({choices:[{finish_reason:'stop',message:{content:json}}]})
  )),/MODEL_RESPONSE_FORMAT_MISMATCH/);
});

test('text probe alone does not claim structured JSON compatibility',async()=>{
  const config=settings({LLM_API_STYLE:'chat-completions'});
  const fetcher:typeof fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',
      message:{content:body.response_format?'OK':'connected'}}]}));
  };
  assert.equal(await probeModelText(config,fetcher),'connected');
  await assert.rejects(callStructuredLLM(config,'test',schema,fetcher),/MODEL_INVALID_JSON/);
});
