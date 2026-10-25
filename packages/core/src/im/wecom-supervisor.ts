import {WecomAdapter} from '../../../im/src/wecom.ts';
import {acceptWecomMessage,listEnabledWecomBots} from '../im/wecom-service.ts';

/** One SDK client per registered bot; never start a second IM service. */
export class WecomSupervisor {
  private running = new Map<string,{botId:string,adapter:WecomAdapter}>();
  private inflight:Promise<void>|null=null;
  private stopping=false;

  synchronize():Promise<void>{
    if(this.stopping)return Promise.resolve();
    if(this.inflight)return this.inflight;
    const task=this.reconcile();
    const tracked=task.finally(()=>{if(this.inflight===tracked)this.inflight=null;});
    this.inflight=tracked;
    return tracked;
  }
  private async reconcile():Promise<void>{
    const bots=await listEnabledWecomBots();
    const wanted=new Map(bots.map(bot=>[bot.id,bot]));
    for(const [id,entry] of this.running){
      const updated=wanted.get(id);
      if(!updated||updated.botId!==entry.botId){
        this.running.delete(id);
        await entry.adapter.stop();
      }
    }
    for(const bot of bots){
      if(this.stopping||this.running.has(bot.id))continue;
      const adapter=new WecomAdapter({
        botId:bot.botId,secret:bot.secret,
        accept:async event=>{
          await acceptWecomMessage(bot.id,event);
        },
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
  async stop():Promise<void>{
    this.stopping=true;
    if(this.inflight)await this.inflight.catch(()=>undefined);
    const sessions=[...this.running.values()];
    this.running.clear();
    await Promise.allSettled(sessions.map(x=>x.adapter.stop()));
  }
}
