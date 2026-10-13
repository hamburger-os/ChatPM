#!/usr/bin/env node
// Can run even when npm ci failed: built-in Node.js modules only.
import { fileURLToPath } from 'node:url';
import { requestStop } from './process-control.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
try{
  const stopped=await requestStop(root);
  console.log(stopped?'ChatPM native foreground services stopped.':
    'No managed ChatPM native foreground services are running.');
}catch(error){
  console.error(error instanceof Error?error.message:'Failed to stop ChatPM.');
  process.exitCode=1;
}
