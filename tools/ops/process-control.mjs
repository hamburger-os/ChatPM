#!/usr/bin/env node
// Local-only native process control. Never kill a PID read from the state file.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const statePath=root=>join(root,'.chatpm-run.json');
function isAlive(pid){
  try{process.kill(pid,0);return true;}
  catch(error){return error?.code!=='ESRCH';}
}
function readState(root){
  let state;
  try{state=JSON.parse(readFileSync(statePath(root),'utf8'));}
  catch(error){
    if(error?.code==='ENOENT')return null;
    throw new Error('Invalid ChatPM runtime state; inspect .chatpm-run.json.');
  }
  if(!state || !Number.isSafeInteger(state.pid) || state.pid<1 ||
     !Number.isInteger(state.port) || state.port<1 || state.port>65535 ||
     typeof state.token!=='string' || !/^[a-f0-9]{64}$/.test(state.token))
    throw new Error('Invalid ChatPM runtime state; inspect .chatpm-run.json.');
  return state;
}
function removeOwned(root,token){
  try{if(readState(root)?.token===token)unlinkSync(statePath(root));}
  catch{/* Never remove an unknown state file. */}
}
export async function startControl(root,onStop){
  const token=randomBytes(32).toString('hex');
  let stopping=false;
  const server=createServer(socket=>{
    socket.setTimeout(75_000,()=>socket.destroy());
    let received='';
    socket.on('data',chunk=>{
      received+=chunk.toString('utf8');
      if(received.length>128){socket.end('DENIED\n');return;}
      if(!received.includes('\n'))return;
      const attempt=Buffer.from(received.slice(0,received.indexOf('\n')));
      received='';
      const expected=Buffer.from(token);
      if(attempt.length!==expected.length || !timingSafeEqual(attempt,expected)){
        socket.end('DENIED\n');return;
      }
      if(stopping){socket.end('STOPPING\n');return;}
      stopping=true;
      Promise.resolve().then(onStop).then(
        ()=>socket.end('STOPPED\n'),
        ()=>socket.end('FAILED\n'),
      );
    });
    socket.on('error',()=>{});
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      server.removeListener('error',reject);
      resolve();
    });
  });
  const state=JSON.stringify({pid:process.pid,port:server.address().port,token})+'\n';
  try{
    try{writeFileSync(statePath(root),state,{flag:'wx',mode:0o600});}
    catch(error){
      if(error?.code!=='EEXIST')throw error;
      const current=readState(root);
      if(!current || isAlive(current.pid))throw error;
      removeOwned(root,current.token);
      writeFileSync(statePath(root),state,{flag:'wx',mode:0o600});
    }
  }catch(error){
    server.close();
    if(error?.code==='EEXIST')
      throw new Error('ChatPM already has a registered runner. Use npm run stop first.');
    throw error;
  }
  let closed=false;
  const cleanup=()=>removeOwned(root,token);
  process.once('exit',cleanup);
  return {close(){
    if(closed)return;
    closed=true;
    cleanup();
    process.removeListener('exit',cleanup);
    server.close();
  }};
}
export async function requestStop(root){
  const state=readState(root);
  if(!state)return false;
  if(!isAlive(state.pid)){
    removeOwned(root,state.token);
    return false;
  }
  try{
    const result=await new Promise((resolve,reject)=>{
      const socket=connect({host:'127.0.0.1',port:state.port});
      let received='';
      socket.setTimeout(75_000,()=>socket.destroy(new Error('Stop request timed out.')));
      socket.on('connect',()=>socket.write(state.token+'\n'));
      socket.on('data',chunk=>{
        received+=chunk.toString('utf8');
        if(received.length>128){socket.destroy(new Error('Invalid stop response.'));return;}
        if(!received.includes('\n'))return;
        const result=received.slice(0,received.indexOf('\n'));
        socket.destroy();
        resolve(result);
      });
      socket.on('error',reject);
      socket.on('end',()=>reject(new Error('Stop connection ended unexpectedly.')));
    });
    if(result!=='STOPPED')throw new Error('Stop was rejected or failed: '+result);
    return true;
  }catch(error){
    throw new Error('ChatPM runner did not confirm a safe stop; no PID was killed. '+
      'Inspect its original terminal. '+(error?.message||''));
  }
}
