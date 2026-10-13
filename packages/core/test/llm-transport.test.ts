import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callStructuredLLM, readLLMSettings } from '../src/llm-transport.ts';

const schema={type:'object',additionalProperties:false,required:['items'],
  properties:{items:{type:'array',items:{type:'string'}}}};
const json=JSON.stringify({items:['task']});
const settings=(extra:Record<string,string>={})=>readLLMSettings({
  LLM_API_KEY:'private-test-key',...extra,
});

test('defaults to OpenAI Responses; private key stays only in request header',async()=>{
  const got:string[]=[];
  const mocked:typeof fetch=async(input,init)=>{
    got.push(String(input));
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
  )),/MODEL_INCOMPLETE_OUTPUT/);
});
