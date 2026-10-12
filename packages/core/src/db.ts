import pg from 'pg';
import { serverConfig } from './config.ts';

export const pool = new pg.Pool({
  connectionString: serverConfig.DATABASE_URL,
  max: serverConfig.DB_POOL_MAX,
  connectionTimeoutMillis: 5000,
});
export type DbClient = pg.PoolClient;

export async function transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function audit(
  db: DbClient,
  projectId: string,
  actorId: string | null,
  action: string,
  targetId: string,
  details: unknown = {},
) {
  await db.query(
    'INSERT INTO audit_entries(project_id, actor_id, action, target_id, details) VALUES ($1,$2,$3,$4,$5)',
    [projectId, actorId, action, targetId, JSON.stringify(details)],
  );
}
