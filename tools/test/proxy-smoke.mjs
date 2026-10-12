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
const email='proxy-smoke-'+randomUUID()+'@example.test';
const headers={'content-type':'application/json','origin':base};
const registered=await request('/api/auth/register',{
  method:'POST',headers,
  body:JSON.stringify({email,displayName:'Proxy Smoke',password:'smoke-password-12345'}),
});
assert.equal(registered.status,200,'Registration through proxy failed: '+await registered.text());
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
