import { pool, transaction } from '../db.ts';
import { localClock } from '../policy.ts';
import { generateScheduledReport } from '../reports.ts';

export async function processReports() {
  // Keyset pagination avoids permanently starving projects beyond the first 1000.
  let cursor:string|null=null;
  while(true){
    const page:{rows:Array<{id:string;timezone:string}>}=await pool.query(
      `SELECT id,timezone FROM projects
       WHERE ($1::uuid IS NULL OR id > $1::uuid)
       ORDER BY id LIMIT 250`,[cursor]);
    if(!page.rows.length)break;
    for(const p of page.rows){
      const time=localClock(new Date(),p.timezone);
      // Catch up within the current reporting period after downtime.
      // Never fabricate snapshots for past periods we can no longer observe.
      const dt=new Date(time.date+'T12:00:00Z');
      const weekly=dt.getUTCDay()!==1 || time.hour>=9;
      const monthly=dt.getUTCDate()!==1 || time.hour>=9;
      if(!weekly&&!monthly)continue;
      await transaction(async db=>{
        if(weekly)await generateScheduledReport(db,p.id,'week');
        if(monthly)await generateScheduledReport(db,p.id,'month');
      });
    }
    cursor=page.rows[page.rows.length-1].id;
  }
}
