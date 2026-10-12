import type { DbClient } from './db.ts';

export type NewMessage = {
  projectId: string;
  authorId: string | null;
  kind: 'user' | 'ai';
  content: string;
  nonce: string;
};

/**
 * All message writers must use this command inside a transaction.
 * Per-project transaction locks serialize sequence allocation with commit order,
 * so "after=seq" readers cannot permanently skip a late-committing message.
 * Different projects remain concurrent.
 */
export async function insertMessage(db: DbClient, input: NewMessage) {
  await db.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    ['chatpm:messages:' + input.projectId],
  );
  const { rows } = await db.query(
    `INSERT INTO messages(project_id,author_id,kind,content,client_nonce)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(project_id,client_nonce) DO NOTHING RETURNING *`,
    [input.projectId, input.authorId, input.kind, input.content, input.nonce],
  );
  return rows[0] as { id: string; seq: string; author_id: string | null; content: string } | undefined;
}
