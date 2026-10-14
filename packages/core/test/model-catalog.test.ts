import assert from 'node:assert/strict';
import {test} from 'node:test';
import {discoverProviderModels,isPrivateModelAddress,assertPublicModelHost} from '../src/model-catalog.ts';
import {importModelName} from '../src/project-model.ts';

const cfg={baseUrl:'https://example.com/v1',apiKey:'test-private-key'};
const skipDns:typeof assertPublicModelHost=async()=>{};
const catalog=(data:unknown)=>new Response(JSON.stringify({data}),{
  status:200,headers:{'Content-Type':'application/json'},
});

test('catalog discovery normalizes, deduplicates and sorts models without leaking secrets',async()=>{
  const result=await discoverProviderModels(cfg,async(url,options)=>{
    assert.equal(url,'https://example.com/v1/models');
    assert.equal(options?.method,'GET');
    assert.equal(options?.redirect,'error');
    assert.equal(new Headers(options?.headers).get('authorization'),'Bearer test-private-key');
    return catalog([{id:'zeta',name:' Zeta '},{id:'alpha',owned_by:'vendor'},
      {id:'alpha'},{id:'  '},{invalid:'x'}]);
  },skipDns);
  assert.deepEqual(result.models,[
    {id:'alpha',name:'alpha',ownedBy:'vendor'},
    {id:'zeta',name:'Zeta',ownedBy:null},
  ]);
  assert.equal(result.truncated,true);
  assert.equal(JSON.stringify(result).includes(cfg.apiKey),false);
});

test('empty catalogs are valid and do not imply model inference compatibility',async()=>{
  const result=await discoverProviderModels(cfg,async()=>catalog([]),skipDns);
  assert.equal(result.models.length,0);
  assert.equal(result.truncated,false);
});

test('catalog discovery rejects unsupported, unauthorized and invalid responses',async()=>{
  for(const status of [401,403,404,405,429,500]){
    await assert.rejects(discoverProviderModels(cfg,async()=>new Response('private-secret',{status}),
      skipDns),e=>{
      assert.equal(String(e).includes('private-secret'),false);
      return true;
    });
  }
  for(const payload of [{models:[{id:'wrong'}]},{data:'bad'},{data:null}]){
    await assert.rejects(discoverProviderModels(cfg,async()=>new Response(JSON.stringify(payload)),
      skipDns),/MODEL_CATALOG_INVALID_RESPONSE/);
  }
});

test('catalog limits large responses, never returns upstream raw bodies',async()=>{
  await assert.rejects(discoverProviderModels(cfg,async()=>
    new Response('x'.repeat(512_001)),skipDns),/MODEL_CATALOG_TOO_LARGE/);
  await assert.rejects(discoverProviderModels(cfg,async()=>{throw new Error('PRIVATE KEY!');},
    skipDns),e=>{
    assert.equal(String(e).includes('PRIVATE KEY!'),false);return true;
  });
});

test('catalog preflight blocks private IPs and DNS resolution to private networks',async()=>{
  for(const address of ['10.1.2.3','172.16.0.1','192.168.1.1','127.0.0.2',
    '169.254.169.254','::1','fc00::1','::ffff:127.0.0.1']){
    assert.equal(isPrivateModelAddress(address),true,address);
  }
  assert.equal(isPrivateModelAddress('8.8.8.8'),false);
  await assert.rejects(assertPublicModelHost('https://10.0.0.1/v1'),
    /MODEL_CATALOG_UNSAFE_ENDPOINT/);
  await assert.doesNotReject(assertPublicModelHost('http://127.0.0.1:8045'));
});

test('long model display names get stable noncolliding suffixes',()=>{
  const prefix='m'.repeat(120);
  const first=importModelName({id:'id-one',name:prefix});
  const second=importModelName({id:'id-two',name:prefix});
  assert.equal(first.length,100);
  assert.notEqual(first,second);
  assert.equal(importModelName({id:'short',name:'Readable'}),'Readable');
});
