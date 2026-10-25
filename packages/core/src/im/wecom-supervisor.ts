import {pool,type DbClient} from '../db.ts';
import {WecomAdapter} from '../../../im/src/wecom.ts';
import type {OutboundText} from '../../../im/src/contracts.ts';
import {acceptWecomMessage,listEnabledWecomBots} from './wecom-service.ts';

// Session-scoped PostgreSQL advisory lock: exactly one active IM connector
// supervisor across API/Worker deployments using the same direct PostgreSQL.
// A worker losing its DB session must stop its sockets. This is NOT compatible
// with transaction-pooling proxies that cannot preserve session affinity.
const LEADER_LOCK_A=92031,LEADER_LOCK_B=20261025;
type ActiveBot={botId:string,adapter:WecomAdapter};

export class WecomSupervisor {
  private readonly running=new Map<string,ActiveBot>();
  private inflight:Promise<void>|null=null;
  private leader:DbClient|null=null;
  private lostHandler:(()=>void)|null=null;
  private stopping=false;

  synchronize():Promise<void>{
    if(this.stopping)return Promise.resolve();
    if(this.inflight)return this.inflight;
    const task=this.reconcile();
    const tracked=task.finally(()=>{if(this.inflight===tracked)this.inflight=null;});
    this.inflight=tracked;
    return tracked;
  }

  private async becomeLeader():Promise<boolean>{
    if(this.leader)return true;
    const client=await pool.connect();
    try{
      const {rows}=await client.query<{acquired:boolean}>(
        'SELECT pg_try_advisory_lock($1,$2) AS acquired',[LEADER_LOCK_A,LEADER_LOCK_B]);
      if(!rows[0]?.acquired){client.release();return false;}
      const lost=()=>{
        if(this.leader!==client)return;
        this.leader=null;
        this.lostHandler=null;
        void this.closeSessions();
      };
      this.leader=client;
      this.lostHandler=lost;
      client.on('error',lost);
      client.on('end',lost);
      return true;
    }catch(error){client.release(true);throw error;}
  }
  private async releaseLeadership():Promise<void>{
    const client=this.leader;
    if(!client)return;
    this.leader=null;
    if(this.lostHandler){
      client.off('error',this.lostHandler);
      client.off('end',this.lostHandler);
      this.lostHandler=null;
    }
    try{
      await client.query('SELECT pg_advisory_unlock($1,$2)',[LEADER_LOCK_A,LEADER_LOCK_B]);
      client.release();
    }catch{client.release(true);}
  }
  private async closeSessions():Promise<void>{
    const old=[...this.running.values()];
    this.running.clear();
    await Promise.allSettled(old.map(x=>x.adapter.stop()));
  }

  private async reconcile():Promise<void>{
    const bots=await listEnabledWecomBots();
    if(!bots.length){
      await this.closeSessions();
      await this.releaseLeadership();
      return;
    }
    if(!await this.becomeLeader())return;
    // Confirm the session-lock connection is live before touching SDK clients.
    await this.leader?.query('SELECT 1');
    const wanted=new Map(bots.map(bot=>[bot.id,bot]));
    for(const [id,entry] of this.running){
      const updated=wanted.get(id);
      if(!updated||updated.botId!==entry.botId){
        this.running.delete(id);
        await entry.adapter.stop();
      }
    }
    for(const bot of bots){
      if(this.stopping||!this.leader||this.running.has(bot.id))continue;
      const adapter=new WecomAdapter({
        botId:bot.botId,secret:bot.secret,
        accept:async event=>{await acceptWecomMessage(bot.id,event);},
        onError:(code)=>console.warn('IM channel error',code),
      });
      this.running.set(bot.id,{botId:bot.botId,adapter});
      try{await adapter.start();}
      catch{
        this.running.delete(bot.id);
        console.warn('IM channel startup failed');
      }
    }
  }

  async send(accountId:string,message:OutboundText):Promise<unknown>{
    const entry=this.leader?this.running.get(accountId):null;
    if(!entry)throw Object.assign(new Error('No active IM session'),{code:'BOT_NOT_CONNECTED'});
    return entry.adapter.send(message);
  }
  async stop():Promise<void>{
    this.stopping=true;
    if(this.inflight)await this.inflight.catch(()=>undefined);
    await this.closeSessions();
    await this.releaseLeadership();
  }
}
