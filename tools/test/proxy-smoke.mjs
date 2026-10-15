import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.CHATPM_BASE_URL || 'http://127.0.0.1:3000';
async function request(path, options = {}) {
  return fetch(new URL(path, base), {cache:'no-store',...options});
}
async function ready() {
  for(let attempt=0;attempt<60;attempt++) {
    try {
      const response=await request('/api/health');
      if (response.ok) return;
    } catch { /* service not ready */ }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Frontend proxy or API not ready');
}
await ready();
const registrationPolicy=await request('/api/auth/registration-policy');
assert.equal(registrationPolicy.status,200);
const policy=await registrationPolicy.json();
assert.equal(policy.allowed,true,'A fresh Docker deployment permits initial enrollment');
const bootstrapToken=process.env.CHATPM_TEST_BOOTSTRAP_TOKEN;
assert.equal(policy.requiresBootstrapToken,Boolean(bootstrapToken),
  'Test must prove the configured open or protected bootstrap policy');
const email='proxy-smoke-'+randomUUID()+'@example.test';
const headers={'content-type':'application/json','origin':base};
if(bootstrapToken){
  const forged=await request('/api/auth/register',{
    method:'POST',headers,
    body:JSON.stringify({email:'forged-'+randomUUID()+'@example.test',
      displayName:'Unknown Operator',password:'smoke-password-12345',
      bootstrapToken:'0'.repeat(64)}),
  });
  assert.equal(forged.status,403,'Unknown visitors must not claim the first tenant');
}
const registered=await request('/api/auth/register',{
  method:'POST',headers,
  body:JSON.stringify({email,displayName:'Proxy Smoke',password:'smoke-password-12345',
    ...(bootstrapToken?{bootstrapToken}:{})}),
});
assert.equal(registered.status,200,'Registration through proxy failed: '+await registered.text());
if(bootstrapToken){
  const after=await request('/api/auth/registration-policy');
  assert.equal((await after.json()).allowed,false,'First-account bootstrap must close enrollment');
  const additional=await request('/api/auth/register',{method:'POST',headers,
    body:JSON.stringify({email:'additional-'+randomUUID()+'@example.test',
      displayName:'Another User',password:'smoke-password-12345',bootstrapToken})});
  assert.equal(additional.status,403,'Reusing a valid token must not permit a second account');
}
const setCookies=registered.headers.getSetCookie();
assert.ok(setCookies.length>0,'Proxy discarded session Set-Cookie');
const cookie=setCookies.map(c=>c.split(';')[0]).join('; ');
assert.ok(cookie.includes('chatpm_session='),'Missing session cookie');
const me=await request('/api/me',{headers:{cookie}});
assert.equal(me.status,200,'Auth cookie forwarding failed');
const identity=await me.json();
assert.equal(identity.user.email,email);
const forbidden=await request('/api/auth/logout',{
  method:'POST',headers:{origin:'https://malicious.example',cookie}
});
assert.equal(forbidden.status,403,'Origin check was bypassed through proxy');
const logout=await request('/api/auth/logout',{method:'POST',headers:{origin:base,cookie}});
assert.equal(logout.status,200,'Logout through proxy failed');
const revoked=await request('/api/me',{headers:{cookie}});
assert.equal(revoked.status,401,'Revoked cookie remains valid');
console.log('Web proxy integration smoke passed: registration, cookie, Origin, logout.');
