import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptModelKey, encryptModelKey } from '../src/project-model.ts';

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
