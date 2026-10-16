import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateModelUrl } from '../src/model-endpoint-policy.ts';
import { readLLMSettings } from '../src/llm-transport.ts';

test('model setup and transport use one URL normalization policy',()=>{
  for(const url of ['https://model.example/v1/','http://127.0.0.1:11434/v1/',
    'http://localhost:11434/v1/']){
    assert.equal(readLLMSettings({LLM_API_KEY:'key',LLM_API_STYLE:'responses',
      LLM_MODEL:'sample',LLM_BASE_URL:url}).baseUrl,validateModelUrl(url));
  }
  for(const url of ['http://model.example/v1','http://169.254.169.254/latest',
    'https://model.example/v1?key=secret','https://model.example/v1/responses',
    'https://user:password@model.example/v1']){
    assert.throws(()=>validateModelUrl(url),/MODEL_INVALID_URL/);
    assert.throws(()=>readLLMSettings({LLM_API_KEY:'key',LLM_API_STYLE:'responses',
      LLM_MODEL:'sample',LLM_BASE_URL:url}),/MODEL_INVALID_URL/);
  }
});
