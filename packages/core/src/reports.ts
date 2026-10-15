import type { DbClient } from './db.ts';
import { periodKey } from './policy.ts';

type TaskSummary = {
  total: number;
  todo: number;
  doing: number;
  blocked: number;
  done: number;
  cancelled: number;
  overdue: number;
};
type ReportSnapshot = {
  name: string;
  timezone: string;
  counts: TaskSummary;
  attention_tasks: Array<{id:string;title:string;status:string}>;
  open_risks: Array<{id:string;title:string}>;
};

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Read all report facts in a single PostgreSQL statement (one MVCC snapshot).
 * Counts cover the full project; only the detailed lists are bounded.
 */
export async function generateReport(
  db: DbClient, projectId: string, kind: 'week'|'month', authorId: string|null,
) {
  const {rows} = await db.query(
    `SELECT p.name, p.timezone,
       (SELECT json_build_object(
         'total', COUNT(*),
         'todo', COUNT(*) FILTER (WHERE status='todo'),
         'doing', COUNT(*) FILTER (WHERE status='doing'),
         'blocked', COUNT(*) FILTER (WHERE status='blocked'),
         'done', COUNT(*) FILTER (WHERE status='done'),
         'cancelled', COUNT(*) FILTER (WHERE status='cancelled'),
         'overdue', COUNT(*) FILTER (
           WHERE due_date < (NOW() AT TIME ZONE p.timezone)::date AND status NOT IN ('done','cancelled'))
       ) FROM tasks WHERE project_id=p.id) AS counts,
       (SELECT COALESCE(json_agg(item), '[]'::json)
        FROM (SELECT id,title,status FROM tasks
              WHERE project_id=p.id AND (
                status='blocked' OR (due_date < (NOW() AT TIME ZONE p.timezone)::date AND status NOT IN ('done','cancelled')))
              ORDER BY due_date ASC NULLS LAST, created_at DESC LIMIT 200) AS item
       ) AS attention_tasks,
       (SELECT COALESCE(json_agg(item), '[]'::json)
        FROM (SELECT id,title FROM risks
              WHERE project_id=p.id AND status<>'resolved'
              ORDER BY created_at DESC LIMIT 100) AS item
       ) AS open_risks
     FROM projects p WHERE p.id=$1`,
    [projectId],
  );
  const snapshot=rows[0] as ReportSnapshot|undefined;
  if(!snapshot) throw new Error('Project not found');
  const key=periodKey(new Date(),snapshot.timezone,kind);
  const c=snapshot.counts;
  const lines=[
    '# '+oneLine(snapshot.name)+' · '+(kind==='week'?'项目周报':'项目月报'),
    '',
    '统计周期标识：'+key,
    '生成时间（UTC）：'+new Date().toISOString(),
    '> 基于生成时的单次数据库快照，不代表历史各日完成率；任务统计覆盖整个项目，阻塞/逾期明细最多 200 条，未解决风险明细最多 100 条。',
    '',
    '## 当前任务概况',
    '- 总数：'+c.total+'；待开始：'+c.todo+'；进行中：'+c.doing+
      '；阻塞：'+c.blocked+'；完成：'+c.done+'；取消：'+c.cancelled,
    '- 当前逾期未完成：'+c.overdue,
    '',
    '## 当前阻塞与逾期事项',
    ...snapshot.attention_tasks.map(t=>'- '+oneLine(t.title)+
      '（状态：'+t.status+'，任务 ID：'+t.id+'）'),
    '',
    '## 当前风险',
    ...snapshot.open_risks.map(r=>'- '+oneLine(r.title)+'（风险 ID：'+r.id+'）'),
    '',
    '## 后续跟进',
    '请负责人核对以上任务事实，并补充尚未登记的本期成果与下期计划。',
  ];
  const content=lines.join('\n');
  const {rows:written}=await db.query(
    `INSERT INTO reports(project_id,kind,period_key,content,author_id)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(project_id,kind,period_key) DO UPDATE
       SET content=EXCLUDED.content,
           author_id=COALESCE(EXCLUDED.author_id,reports.author_id),
           revision=reports.revision+1
       WHERE reports.state='draft'
     RETURNING *`,
    [projectId,kind,key,content,authorId],
  );
  if(written[0]) return written[0];
  const existing=await db.query(
    'SELECT * FROM reports WHERE project_id=$1 AND kind=$2 AND period_key=$3',
    [projectId,kind,key],
  );
  return existing.rows[0];
}

/**
 * Scheduled reports are one-shot per project/kind/period. Manual generation
 * still refreshes drafts, but a recurring Worker must never overwrite them.
 * Must be called inside a DB transaction so the advisory lock spans the read
 * and the insert. Multiple Worker replicas are safe.
 */
export async function generateScheduledReport(db:DbClient,projectId:string,kind:'week'|'month'):Promise<boolean>{
  const project=await db.query('SELECT timezone FROM projects WHERE id=$1',[projectId]);
  if(!project.rows[0])return false;
  const key=periodKey(new Date(),project.rows[0].timezone,kind);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    ['chatpm:report:'+projectId+':'+kind+':'+key]);
  const existing=await db.query(
    'SELECT 1 FROM reports WHERE project_id=$1 AND kind=$2 AND period_key=$3',
    [projectId,kind,key]);
  if(existing.rowCount)return false;
  await generateReport(db,projectId,kind,null);
  return true;
}
