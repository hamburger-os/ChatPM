import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { signedQuotaKey } from '../src/quota-key.ts';

const secret='unit-test-session-secret-at-least-32-characters';
async function session(sub:string){
  return new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(sub)
    .setExpirationTime('10m').sign(new TextEncoder().encode(secret));
}
test('different verified users behind one Next.js peer have independent quotas',async()=>{
  const alice=await session('alice'),bob=await session('bob');
  assert.equal(await signedQuotaKey({url:'/projects',ip:'127.0.0.1',cookies:{chatpm_session:alice}},secret),'user:alice');
  assert.equal(await signedQuotaKey({url:'/projects',ip:'127.0.0.1',cookies:{chatpm_session:bob}},secret),'user:bob');
});
test('invalid or unsigned cookies cannot mint new quota identities',async()=>{
  const ip='127.0.0.1';
  assert.equal(await signedQuotaKey({url:'/projects',ip,cookies:{chatpm_session:'fake-1'}},secret),'ip:'+ip);
  assert.equal(await signedQuotaKey({url:'/projects',ip,cookies:{chatpm_session:'fake-2'}},secret),'ip:'+ip);
  assert.equal(await signedQuotaKey({url:'/projects',ip},secret),'ip:'+ip);
});
test('registration and login remain IP-scoped even with valid sessions',async()=>{
  const token=await session('alice');
  for(const url of ['/auth/register','/auth/login','/auth/logout']){
    assert.equal(await signedQuotaKey({url,ip:'127.0.0.1',cookies:{chatpm_session:token}},secret),'ip:127.0.0.1');
  }
});
test('tampered signed cookies cannot bypass anonymous IP quotas',async()=>{
  const token=await session('alice');
  const corrupt=token.slice(0,-3)+'foo';
  assert.equal(await signedQuotaKey({url:'/me',ip:'::1',cookies:{chatpm_session:corrupt}},secret),'ip:::1');
});
