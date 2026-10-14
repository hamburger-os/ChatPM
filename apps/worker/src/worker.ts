import 'dotenv/config';
import { pool } from '../../../packages/core/src/db.ts';
import { processEvents } from '../../../packages/core/src/conversation/ai-event-runner.ts';
import { processReminders } from '../../../packages/core/src/automation/reminder-runner.ts';
import { processReports } from '../../../packages/core/src/reporting/period-runner.ts';

let busy=false;
let lastReportScanSlot=-1;
async function tick() {
  if(busy)return;
  busy=true;
  let succeeded=false;
  try {
    await processEvents();
    await processReminders();
    // Bounded catch-up scan once per 5-minute slot; DB lock prevents duplicates.
    const slot=Math.floor(Date.now()/300000);
    if(lastReportScanSlot!==slot){
      await processReports();
      lastReportScanSlot=slot;
    }
    succeeded=true;
  }
  catch(e) { console.error('Worker tick failed',e instanceof Error?e.message:e); }
  finally {
    try {
      await pool.query(`INSERT INTO worker_health(name,last_seen_at,last_success_at,last_failure_at)
        VALUES('default',NOW(),CASE WHEN $1::boolean THEN NOW() ELSE NULL END,
          CASE WHEN $1::boolean THEN NULL ELSE NOW() END)
        ON CONFLICT (name) DO UPDATE SET
          last_seen_at=NOW(),
          last_success_at=CASE WHEN $1::boolean THEN NOW() ELSE worker_health.last_success_at END,
          last_failure_at=CASE WHEN $1::boolean THEN worker_health.last_failure_at ELSE NOW() END`,
        [succeeded]);
    } catch(e) {
      console.error('Worker heartbeat failed',e instanceof Error?e.name:'UnknownFailure');
    }
    busy=false;
  }
}
console.log('ChatPM worker started: reliable outbox, reminders and report drafts.');
let activeTick:Promise<void>|null=null;
let stopping=false;
function scheduleTick(){
  if(stopping || activeTick)return;
  activeTick=tick().finally(()=>{activeTick=null;});
}
const timer=setInterval(scheduleTick,15000);
async function shutdown(){
  if(stopping)return;
  stopping=true;
  clearInterval(timer);
  if(activeTick)await activeTick;
  await pool.end();
  if (process.connected) process.disconnect();
}
// The one-terminal runner uses IPC on Windows because SIGTERM forcibly terminates Node there.
if (process.send) {
  process.on('message', (message: unknown) => {
    if (message && typeof message === 'object' &&
        'type' in message && message.type === 'chatpm:shutdown') {
      void shutdown().then(() => {
        if (process.connected) process.disconnect();
      }).catch(e => { console.error('IPC shutdown failed', e); process.exitCode=1; });
    }
  });
}
process.once('SIGTERM',()=>{void shutdown().catch(e=>{console.error('Shutdown failed',e);process.exitCode=1;});});
process.once('SIGINT',()=>{void shutdown().catch(e=>{console.error('Shutdown failed',e);process.exitCode=1;});});
scheduleTick();
