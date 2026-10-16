import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptModelKey, encryptModelKey, resolveProjectModel } from '../src/project-model.ts';
import type { DbClient } from '../src/db.ts';

test('platform model keys use randomized authenticated encryption',()=>{
  const before=process.env.MODEL_ENCRYPTION_KEY;
  try{
    process.env.MODEL_ENCRYPTION_KEY='test-secret-for-encryption-strong-012345678901';
    const encryptedA=encryptModelKey('private-model-api-key');
    const encryptedB=encryptModelKey('private-model-api-key');
    assert.notEqual(encryptedA,encryptedB);
    assert.equal(decryptModelKey(encryptedA),'private-model-api-key');
    assert.equal(encryptedA.includes('private-model-api-key'),false);
    const damaged=Buffer.from(encryptedA,'base64');
    damaged[damaged.length-1]^=1;
    assert.throws(()=>decryptModelKey(damaged.toString('base64')),/MODEL_KEY_DECRYPTION_FAILED/);
    process.env.MODEL_ENCRYPTION_KEY='rotated-secret-that-is-also-long-and-is-not-same';
    assert.throws(()=>decryptModelKey(encryptedA),/MODEL_KEY_DECRYPTION_FAILED/);
  }finally{
    if(before===undefined)delete process.env.MODEL_ENCRYPTION_KEY;
    else process.env.MODEL_ENCRYPTION_KEY=before;
  }
});

test('project model resolution reuses the active command transaction connection',async()=>{
  const before=process.env.MODEL_ENCRYPTION_KEY;
  try{
    process.env.MODEL_ENCRYPTION_KEY='tx-test-model-key-at-least-thirty-two-characters';
    const queries:string[]=[];
    const fakeDb={query:async(sql:string)=>{
      queries.push(sql);
      if(sql.includes('FROM projects'))return {rowCount:1,rows:[{id:'project'}]};
      if(sql.includes('FROM ai_model_configs'))return {rowCount:1,rows:[{
        model_id:'sample-model',base_url:'https://model.example/v1',api_style:'responses',
        api_key_ciphertext:encryptModelKey('fake-key'),provider_enabled:true,enabled:true,
        reasoning:'auto',reasoning_format:'none',max_output_tokens:2048,context_chars:6500,
      }]};
      throw new Error('Unexpected query');
    }} as unknown as DbClient;
    const settings=await resolveProjectModel('fake-project',fakeDb);
    assert.equal(settings.model,'sample-model');
    assert.equal(queries.length,2);
    assert.ok(queries[0].includes('FROM projects'));
    assert.ok(queries[1].includes('FROM ai_model_configs'));
  }finally{
    if(before===undefined)delete process.env.MODEL_ENCRYPTION_KEY;
    else process.env.MODEL_ENCRYPTION_KEY=before;
  }
});
