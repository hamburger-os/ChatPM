import type { DbClient } from './db.ts';
import { periodKey } from './policy.ts';

export async function generateReport(
  db: DbClient, projectId: string, kind: 'week'|'month', authorId: string|null,
) {
  const { rows: projects } = await db.query('SELECT id,name,timezone FROM projects WHERE id=$1', [projectId]);
  const project = projects[0];
  if (!project) throw new Error('Project not found');
  const key = periodKey(new Date(), project.timezone, kind);
  const { rows: tasks } = await db.query(
    `SELECT id,title,status,due_at,assignee_id FROM tasks WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [projectId],
  );
  const { rows: risks } = await db.query(
    `SELECT id,title,status FROM risks WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [projectId],
  );
  const by = (status: string) => tasks.filter(t => t.status === status).length;
  const overdue = tasks.filter(t => t.due_at && t.status !== 'done' &&
    t.status !== 'cancelled' && new Date(t.due_at).getTime() < Date.now());
  const lines = [
    '# ' + project.name + ' · ' + (kind === 'week'?'项目周报':'项目月报'),
    '',
    '统计周期标识：' + key,
    '生成时间（UTC）：' + new Date().toISOString(),
    '> 基于生成时的项目状态快照，不代表历史各日完成率；任务列表最多展示最近 200 项。',
    '',
    '## 当前任务概况',
    '- 总数：' + tasks.length + '；待开始：' + by('todo') +
    '；进行中：' + by('doing') + '；阻塞：' + by('blocked') +
    '；完成：' + by('done') + '；取消：' + by('cancelled'),
    '- 当前逾期未完成：' + overdue.length,
    '',
    '## 当前阻塞与逾期事项',
    ...(tasks.filter(t=>t.status==='blocked'||overdue.includes(t))
      .map(t=>'- '+t.title+'（状态：'+t.status+'，任务 ID：'+t.id+'）')),
    '',
    '## 当前风险',
    ...(risks.filter(r=>r.status==='open').map(r=>'- '+r.title+'（风险 ID：'+r.id+'）')),
    '',
    '## 后续跟进',
    '请负责人核对以上任务事实，并补充尚未登记的本期成果与下期计划。',
  ];
  const content = lines.join('\n');
  const {rows} = await db.query(
    `INSERT INTO reports(project_id,kind,period_key,content,author_id)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(project_id,kind,period_key) DO NOTHING
     RETURNING *`,
    [projectId,kind,key,content,authorId],
  );
  if(rows[0])return rows[0];
  const existing=await db.query(
    'SELECT * FROM reports WHERE project_id=$1 AND kind=$2 AND period_key=$3',
    [projectId,kind,key]);
  return existing.rows[0];
}
