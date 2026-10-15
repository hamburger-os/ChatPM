import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbClient } from '../src/db.ts';
import { configuredRegistrationMode,enforceRegistration,mayRegister,verifyBootstrapToken } from '../src/identity/registration-policy.ts';

test('production defaults to bootstrap, not unrestricted public registration',()=>{
  assert.equal(configuredRegistrationMode('production'),'bootstrap');
  assert.equal(configuredRegistrationMode('development'),'open');
  assert.equal(configuredRegistrationMode('test'),'open');
  assert.equal(configuredRegistrationMode('production','open'),'open');
  assert.equal(configuredRegistrationMode('production','closed'),'closed');
});
test('only explicitly open public registration accepts additional accounts',()=>{
  for(const [mode,hasUsers,allowed] of [
    ['open',false,true],['open',true,true],
    ['bootstrap',false,true],['bootstrap',true,false],
    ['closed',false,false],['closed',true,false],
  ] as const)assert.equal(mayRegister(mode,hasUsers),allowed);
});
test('operator secret is required and checked without plain string comparison',()=>{
  const token='a'.repeat(64);
  assert.equal(verifyBootstrapToken(token,token),true);
  assert.equal(verifyBootstrapToken(token.toUpperCase(),token),true);
  assert.equal(verifyBootstrapToken('b'.repeat(64),token),false);
  assert.equal(verifyBootstrapToken(undefined,token),false);
  assert.equal(verifyBootstrapToken(token,undefined),false);
  assert.equal(verifyBootstrapToken('short',token),false);
  assert.equal(verifyBootstrapToken(token,'short'),false);
});
test('bootstrap mode locks before checking for an existing user',async()=>{
  const calls:string[]=[];
  function db(exists:boolean):DbClient{
    return {query:async(sql:string)=>{
      calls.push(sql);
      return {rowCount:sql.includes('FROM users')&&exists?1:0};
    }} as unknown as DbClient;
  }
  await enforceRegistration(db(false),'bootstrap','a'.repeat(64),'a'.repeat(64));
  assert.match(calls[0],/pg_advisory_xact_lock/);
  assert.match(calls[1],/FROM users/);
  calls.length=0;
  await assert.rejects(enforceRegistration(db(true),'bootstrap','a'.repeat(64),'a'.repeat(64)),
    /公开注册已关闭/);
  assert.equal(calls.length,2);
  calls.length=0;
  await assert.rejects(enforceRegistration(db(false),'bootstrap','b'.repeat(64),'a'.repeat(64)),
    /公开注册已关闭/);
  assert.equal(calls.length,2,'Unknown or invalid bootstrap tokens must not authorize creation');
  calls.length=0;
  await enforceRegistration(db(true),'open');
  assert.equal(calls.length,0,'Explicit open does not take the bootstrap lock');
  await assert.rejects(enforceRegistration(db(false),'closed'),
    /公开注册已关闭/);
  assert.equal(calls.length,0,'Disabled mode must not even query user records');
});
