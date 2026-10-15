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
  activity_counts:{created:number;completed:number;reopened:number;
    blocked:number;dueChanged:number;total:number};
  activity_events:Array<{
    id:string;task_id:string;kind:'created'|'updated';title:string;
    before_status:string|null;after_status:string;
    before_due_date:string|null;after_due_date:string|null;
  }>;
};

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Read all report facts in a single PostgreSQL statement (one MVCC snapshot).
 * Counts cover the full project; only the detailed lists are bounded.
 */
export async function generateReport(
  db: DbClient, projectId: string, kind: 'week'|'month', authorId: string|null,
) {
  const generatedAt=new Date();
  const {rows} = await db.query(
    `WITH focus AS (
       SELECT p.*,
         date_trunc($2::text,$3::timestamptz AT TIME ZONE p.timezone) AS period_start,
         date_trunc($2::text,$3::timestamptz AT TIME ZONE p.timezone)
           + CASE WHEN $2='week' THEN INTERVAL '7 days'
                  ELSE INTERVAL '1 month' END AS period_end
       FROM projects p WHERE p.id=$1
     )
     SELECT p.name, p.timezone,
       (SELECT json_build_object(
         'total', COUNT(*),
         'todo', COUNT(*) FILTER (WHERE status='todo'),
         'doing', COUNT(*) FILTER (WHERE status='doing'),
         'blocked', COUNT(*) FILTER (WHERE status='blocked'),
         'done', COUNT(*) FILTER (WHERE status='done'),
         'cancelled', COUNT(*) FILTER (WHERE status='cancelled'),
         'overdue', COUNT(*) FILTER (
           WHERE due_date < ($3::timestamptz AT TIME ZONE p.timezone)::date AND status NOT IN ('done','cancelled'))
       ) FROM tasks WHERE project_id=p.id) AS counts,
       (SELECT COALESCE(json_agg(item), '[]'::json)
        FROM (SELECT id,title,status FROM tasks
              WHERE project_id=p.id AND (
                status='blocked' OR (due_date < ($3::timestamptz AT TIME ZONE p.timezone)::date AND status NOT IN ('done','cancelled')))
              ORDER BY due_date ASC NULLS LAST, created_at DESC LIMIT 200) AS item
       ) AS attention_tasks,
       (SELECT COALESCE(json_agg(item), '[]'::json)
        FROM (SELECT id,title FROM risks
              WHERE project_id=p.id AND status<>'resolved'
              ORDER BY created_at DESC LIMIT 100) AS item
       ) AS open_risks,
         (SELECT json_build_object(
           'created', COUNT(*) FILTER (WHERE h.kind='created'),
           'completed', COUNT(DISTINCT h.task_id) FILTER (WHERE
             h.kind='updated' AND h.before_status IS DISTINCT FROM 'done'
             AND h.after_status='done'),
           'reopened', COUNT(DISTINCT h.task_id) FILTER (WHERE
             h.kind='updated' AND h.before_status='done'
             AND h.after_status<>'done'),
           'blocked', COUNT(DISTINCT h.task_id) FILTER (WHERE
             h.kind='updated' AND h.before_status IS DISTINCT FROM 'blocked'
             AND h.after_status='blocked'),
           'dueChanged', COUNT(*) FILTER (WHERE h.kind='updated'
             AND h.before_due_date IS DISTINCT FROM h.after_due_date),
           'total', COUNT(*)
         ) FROM project_task_history h
           WHERE h.project_id=p.id
             AND h.changed_at >= (p.period_start AT TIME ZONE p.timezone)
             AND h.changed_at < (p.period_end AT TIME ZONE p.timezone)
         ) AS activity_counts,
         (SELECT COALESCE(json_agg(item), '[]'::json)
          FROM (SELECT h.id,h.task_id,h.kind,h.after_title AS title,
                 h.before_status,h.after_status,
                 h.before_due_date::text AS before_due_date,
                 h.after_due_date::text AS after_due_date
                FROM project_task_history h
                WHERE h.project_id=p.id
                  AND h.changed_at >= (p.period_start AT TIME ZONE p.timezone)
                  AND h.changed_at < (p.period_end AT TIME ZONE p.timezone)
                ORDER BY h.changed_at DESC,h.id DESC LIMIT 100) item
         ) AS activity_events
     FROM focus p`,
    [projectId,kind,generatedAt],
  );
  const snapshot=rows[0] as ReportSnapshot|undefined;
  if(!snapshot) throw new Error('Project not found');
  const key=periodKey(generatedAt,snapshot.timezone,kind);
  const c=snapshot.counts;
  const history=snapshot.activity_counts;
  const changeLine=(event:ReportSnapshot['activity_events'][number])=>{
    const facts:string[]=[];
    if(event.kind==='created')facts.push('创建');
    if(event.kind==='updated'&&event.before_status!==event.after_status)
      facts.push('状态 '+event.before_status+' → '+event.after_status);
    if(event.kind==='updated'&&event.before_due_date!==event.after_due_date)
      facts.push('期限 '+(event.before_due_date??'未设置')+' → '+(event.after_due_date??'未设置'));
    if(!facts.length)facts.push('任务计划内容调整');
    return '- '+oneLine(event.title)+'：'+facts.join('；')+
      '（任务 ID '+event.task_id+'，历史事件 ID '+event.id+'）';
  };
  const lines=[
    '# '+oneLine(snapshot.name)+' · '+(kind==='week'?'项目周报':'项目月报'),
    '',
    '统计周期标识：'+key,
    '生成时间（UTC）：'+generatedAt.toISOString(),
    '> 当前任务概况是生成时快照；本期变化仅包含启用历史记录之后可追溯的真实操作，不补造历史；明细最多 100 条，计数不截断。',
    '',
    '## 本期任务实际变化（项目当地日期）',
    '- 新增任务：'+history.created+'；进入完成状态的任务数：'+history.completed+
      '；重新打开的任务数：'+history.reopened+'；进入阻塞的任务数：'+history.blocked+
      '；期限设定/调整次数：'+history.dueChanged,
    '- 本期任务历史事件总数：'+history.total,
    '',
    '### 本期变化证据（最近 100 条）',
    ...(snapshot.activity_events.length?snapshot.activity_events.map(changeLine):
      ['- 本期没有可用任务历史事件。']),
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
