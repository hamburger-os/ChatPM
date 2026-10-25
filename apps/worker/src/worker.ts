import 'dotenv/config';
import {WecomSupervisor} from '../../../packages/core/src/im/wecom-supervisor.ts';
import {processImDeliveries} from '../../../packages/core/src/im/delivery-runner.ts';
import { pool } from '../../../packages/core/src/db.ts';
import {recordWorkerHeartbeat,type WorkerLane} from '../../../packages/core/src/operations/worker-heartbeat.ts';
import { processEvents } from '../../../packages/core/src/conversation/ai-event-runner.ts';
import { processReminders } from '../../../packages/core/src/automation/reminder-runner.ts';
import { processReports } from '../../../packages/core/src/reporting/period-runner.ts';

// A slow or failed model call must never hold reminders or periodic reporting
// behind it. Each lane has its own single-flight lock and independent retry.
const inFlight = new Map<WorkerLane,Promise<void>>();
const im=new WecomSupervisor();
let imSendInFlight:Promise<void>|null=null;
function dispatchImDeliveries():void{
  if(stopping||imSendInFlight)return;
  const task=processImDeliveries((id,message)=>im.send(id,message))
    .catch(()=>console.warn('IM delivery runner failed'));
  imSendInFlight=task;
  void task.finally(()=>{if(imSendInFlight===task)imSendInFlight=null;});
}
let stopping=false;
let lastReportScanSlot=-1;

function dispatch(lane:WorkerLane,job:()=>Promise<void>):void{
  if(stopping||inFlight.has(lane))return;
  const active=(async()=>{
    let succeeded=false;
    try {
      await job();
      succeeded=true;
    } catch(error){
      console.error('Worker lane failed',lane,error instanceof Error?error.name:'UnknownFailure');
    } finally {
      try {
        await recordWorkerHeartbeat(lane,succeeded);
      } catch(error) {
        console.error('Worker heartbeat failed',error instanceof Error?error.name:'UnknownFailure');
      }
    }
  })();
  inFlight.set(lane,active);
  void active.finally(()=>{if(inFlight.get(lane)===active)inFlight.delete(lane);});
}

function scheduleTick():void{
  if(stopping)return;
  dispatch('events',()=>processEvents());
  dispatch('reminders',()=>processReminders());
  const slot=Math.floor(Date.now()/300000);
  if(lastReportScanSlot!==slot){
    dispatch('reports',async()=>{
      await processReports();
      lastReportScanSlot=slot;
    });
  }
}
console.log('ChatPM worker started: independent AI, reminder and reporting lanes.');
const timer=setInterval(scheduleTick,15000);
const imTimer=setInterval(()=>void im.synchronize().catch(()=>{
  console.warn('IM channel reconciliation failed');
}),60000);
void im.synchronize().catch(()=>{console.warn('IM startup reconciliation failed');});
const imSendTimer=setInterval(dispatchImDeliveries,15000);
dispatchImDeliveries();
async function shutdown(){
  if(stopping)return;
  stopping=true;
  clearInterval(timer);
  clearInterval(imTimer);
  clearInterval(imSendTimer);
  await im.stop();
  if(imSendInFlight)await Promise.allSettled([imSendInFlight]);
  await Promise.allSettled([...inFlight.values()]);
  await pool.end();
  if(process.connected)process.disconnect();
}
if(process.send){
  process.on('message',(message:unknown)=>{
    if(message&&typeof message==='object'&&'type' in message&&
       message.type==='chatpm:shutdown'){
      void shutdown().catch(error=>{
        console.error('IPC shutdown failed',error);process.exitCode=1;
      });
    }
  });
}
process.once('SIGTERM',()=>{void shutdown().catch(error=>{
  console.error('Shutdown failed',error);process.exitCode=1;
});});
process.once('SIGINT',()=>{void shutdown().catch(error=>{
  console.error('Shutdown failed',error);process.exitCode=1;
});});
scheduleTick();
