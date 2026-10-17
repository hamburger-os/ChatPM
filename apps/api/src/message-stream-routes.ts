import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {listProjectMessages} from '../../../packages/core/src/conversation/message-queries.ts';

const uuid=z.string().uuid();
const cursor=z.string().regex(/^(?:0|[1-9][0-9]{0,15})$/).transform(v=>{
  const parsed=Number(v);
  if(!Number.isSafeInteger(parsed))throw Object.assign(
    new Error('消息游标超出安全范围'),{statusCode:400});
  return parsed;
});

/** Event IDs are committed PostgreSQL message sequences, not process-local
 * offsets. Last-Event-ID takes priority on reconnect, and missing messages
 * are replayed in bounded, ordered pages from the source of truth.
 */
export function registerMessageStreamRoutes(
  app:FastifyInstance,authenticated:(req:FastifyRequest)=>Promise<string>,
):void{
  app.get('/projects/:id/messages/events',async(req,reply)=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const q=z.object({after:cursor.optional()}).parse(req.query);
    const last=req.headers['last-event-id'];
    const start=typeof last==='string'?cursor.parse(last):q.after??0;
    const actorId=await authenticated(req);
    // Do not send stream headers until current project membership is proven.
    await listProjectMessages(projectId,actorId,{after:start,limit:1});
    reply.hijack();
    reply.raw.writeHead(200,{
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no',
    });
    reply.raw.write(': connected\n\n');

    let active=true;
    let busy=false;
    let after=start;
    let ping:NodeJS.Timeout;
    let timer:NodeJS.Timeout;
    const cleanup=()=>{
      if(!active)return;
      active=false;
      clearInterval(timer);
      clearInterval(ping);
    };
    reply.raw.once('close',cleanup);

    async function write(chunk:string):Promise<boolean>{
      if(!active)return false;
      if(!reply.raw.write(chunk)){
        // Respect HTTP backpressure instead of unbounded buffering of chat.
        await new Promise<void>(resolve=>{
          const done=()=>{
            reply.raw.off('drain',done);
            reply.raw.off('close',done);
            resolve();
          };
          reply.raw.once('drain',done);
          reply.raw.once('close',done);
        });
      }
      return active;
    }

    async function pump(){
      if(!active||busy)return;
      busy=true;
      try{
        // The request may outlive the session. Verify session and locked
        // Tenant/Project membership on every delivery batch, not just connect.
        if(await authenticated(req)!==actorId)throw new Error('SESSION_CHANGED');
        for(let page=0;page<4&&active;page++){
          const batch=await listProjectMessages(projectId,actorId,
            {after,limit:100});
          if(!active)break;
          for(const m of batch.messages){
            const frame='id: '+m.seq+'\nevent: message\ndata: '+JSON.stringify(m)+'\n\n';
            if(!await write(frame))return;
            after=Number(m.seq);
          }
          if(!batch.hasMore)break;
        }
      }catch{
        // No business content or internal error details are sent on auth
        // revocation or database failure; EventSource may reconnect later.
        cleanup();
        reply.raw.end();
      }finally{
        busy=false;
      }
    }
    timer=setInterval(()=>void pump(),2500);
    ping=setInterval(()=>{
      if(active&&!busy)void write(': keep-alive\n\n');
    },15000);
    timer.unref();
    ping.unref();
    void pump();
    return reply;
  });
}
