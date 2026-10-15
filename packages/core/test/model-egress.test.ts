import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {
  secureModelFetch,assertPublicModelHost,isPrivateModelAddress,
  isAllowedDockerGatewayAddress,
} from '../src/model-egress.ts';

const publicDns=async (_name:string,_opts:unknown)=>[
  {address:'8.8.8.8',family:4},
  {address:'2606:4700:4700::1111',family:6},
];
const mappedPrivate=['127.0.0.2','10.8.0.4','169.254.169.254',
  '192.168.4.6','172.31.0.1','100.64.0.1','fc00::2','::ffff:127.0.0.1',
  '::ffff:169.254.169.254','fec0::1','64:ff9b:1::a9fe:a9fe',
  '192.88.99.1'];
test('public endpoint addresses are checked as an entire DNS answer set',async()=>{
  for(const address of mappedPrivate)
    assert.equal(isPrivateModelAddress(address),true,address);
  assert.equal(isPrivateModelAddress('8.8.8.8'),false);
  await assert.doesNotReject(assertPublicModelHost('https://api.example.com/v1',
    publicDns));
  await assert.rejects(assertPublicModelHost('https://api.example.com/v1',
    (async()=>[{address:'8.8.8.8',family:4},
      {address:'169.254.169.254',family:4}])),
    /MODEL_CATALOG_UNSAFE_ENDPOINT/);
  await assert.rejects(assertPublicModelHost('https://api.example.com/v1',
    (async()=>[{address:'::1',family:6}])),
    /MODEL_CATALOG_UNSAFE_ENDPOINT/);
  await assert.rejects(assertPublicModelHost('https://api.example.com/v1',
    (async()=>[])),
    /MODEL_CATALOG_UNSAFE_ENDPOINT/);
  await assert.rejects(assertPublicModelHost('https://api.example.com/v1',
    (async()=>{throw new Error('resolver secret');})),
    /MODEL_CATALOG_DNS_FAILED/);
});
test('local exceptions remain explicit and reject public DNS aliases',async()=>{
  await assert.doesNotReject(assertPublicModelHost('http://127.0.0.1:11434/v1'));
  await assert.doesNotReject(assertPublicModelHost('http://[::1]:11434/v1'));
  await assert.rejects(assertPublicModelHost('http://127.0.0.2:11434/v1'),
    /MODEL_EGRESS_INVALID_URL/);
  await assert.rejects(assertPublicModelHost('http://api.example.com/v1'),
    /MODEL_EGRESS_INVALID_URL/);
  await assert.rejects(assertPublicModelHost('https://localhost/v1',
    (async()=>[{address:'8.8.8.8',family:4}])),
    /MODEL_CATALOG_UNSAFE_ENDPOINT/);
});
test('host.docker.internal cannot be DNS-rebound to metadata or public endpoints',async()=>{
  for(const address of ['10.9.8.7','172.18.0.1','192.168.65.254',
    'fd12::1','::ffff:10.20.30.40'])
    assert.equal(isAllowedDockerGatewayAddress(address),true,address);
  for(const address of ['169.254.169.254','::ffff:169.254.169.254',
    '127.0.0.1','::1','fe80::1','fec0::1','100.64.1.2',
    '198.18.0.1','8.8.8.8','2606:4700:4700::1111'])
    assert.equal(isAllowedDockerGatewayAddress(address),false,address);
  for(const unsafeAddress of ['169.254.169.254','::ffff:169.254.169.254',
    '127.0.0.1','::1','fe80::1','100.64.1.2','8.8.8.8']){
    const family=unsafeAddress.includes(':')?6:4;
    await assert.rejects(assertPublicModelHost('http://host.docker.internal:11434/v1',
      async()=>[{address:'172.19.0.1',family:4},
        {address:unsafeAddress,family}]),
      /MODEL_CATALOG_UNSAFE_ENDPOINT/,
      'Mixed safe and unsafe DNS sets must fail: '+unsafeAddress);
  }
  await assert.doesNotReject(assertPublicModelHost('http://host.docker.internal:11434/v1',
    async()=>[{address:'172.19.0.1',family:4},
      {address:'fd00::2',family:6}]));
  await assert.rejects(assertPublicModelHost('http://localhost:11434/v1',
    async()=>[{address:'172.19.0.1',family:4}]),
    /MODEL_CATALOG_UNSAFE_ENDPOINT/);
});
test('real local socket POST retains authorization but refuses redirects and bounded bodies',async()=>{
  const seen:Array<{path:string;authorization:string|null;body:string}>=[];
  const server=createServer((req,res)=>{
    let body='';
    req.setEncoding('utf8');
    req.on('data',s=>{body+=s;});
    req.on('end',()=>{
      seen.push({path:req.url??'',authorization:req.headers.authorization??null,body});
      if(req.url==='/redirect'){
        res.writeHead(302,{location:'http://127.0.0.1:22/private'});
        res.end('never follow');return;
      }
      if(req.url==='/oversize'){
        res.writeHead(200,{'content-type':'application/json'});
        res.end('x'.repeat(2_000_001));return;
      }
      res.writeHead(200,{'content-type':'application/json'});
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();
    if(!address||typeof address==='string')throw new Error('Missing test port');
    const base='http://127.0.0.1:'+address.port;
    const valid=await secureModelFetch(base+'/v1/responses',{
      method:'POST',redirect:'error',headers:{
        Authorization:'Bearer local-test-secret','Content-Type':'application/json'},
      body:'{"hello":"world"}',signal:AbortSignal.timeout(5000),
    });
    assert.equal(valid.status,200);
    assert.deepEqual(await valid.json(),{ok:true});
    assert.deepEqual(seen[0],{path:'/v1/responses',
      authorization:'Bearer local-test-secret',body:'{"hello":"world"}'});
    await assert.rejects(secureModelFetch(base+'/redirect',{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),
    }),/MODEL_EGRESS_REDIRECT_BLOCKED/);
    assert.equal(seen.length,2,'Redirect must never open another connection');
    await assert.rejects(secureModelFetch(base+'/oversize',{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),
    }),/MODEL_EGRESS_RESPONSE_TOO_LARGE/);
    await assert.rejects(secureModelFetch(base+'/v1/responses',{
      method:'POST',redirect:'follow',body:'{"token":"secret"}',
    }),/MODEL_EGRESS_REDIRECT_POLICY/);
    assert.equal(seen.length,3,'Unsafe request must fail before network egress');
    for(const name of ['Host','Proxy-Authorization','Connection',
      'Content-Length','Transfer-Encoding','Forwarded','Accept-Encoding']){
      await assert.rejects(secureModelFetch(base+'/v1/responses',{
        method:'POST',redirect:'error',headers:{[name]:'untrusted-override'},
        body:'{"token":"secret"}',
      }),/MODEL_EGRESS_INVALID_HEADER/,name);
    }
    assert.equal(seen.length,3,'Rejected outbound headers cannot hit a socket');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
