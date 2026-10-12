import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pool } from './db.ts';

const directory=fileURLToPath(new URL('../sql/', import.meta.url));
const db=await pool.connect();
try {
  // Session-level lock also protects the initial migrations table creation.
  await db.query('SELECT pg_advisory_lock(21844, 7301)');
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const files=(await readdir(directory)).filter(f=>/^\d+_[\w-]+\.sql$/.test(f)).sort();
  for(const name of files){
    const sql=await readFile(join(directory,name),'utf8');
    const hash=createHash('sha256').update(sql).digest('hex');
    await db.query('BEGIN');
    try{
      const existing=await db.query('SELECT checksum FROM schema_migrations WHERE version=$1',[name]);
      if(existing.rows[0]){
        if(existing.rows[0].checksum!==hash) throw new Error('Migration was modified: '+name);
      }else{
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[name,hash]);
        console.log('Applied '+name);
      }
      await db.query('COMMIT');
    }catch(error){
      await db.query('ROLLBACK');
      throw error;
    }
  }
  console.log('Database migrations complete.');
}finally{
  try{await db.query('SELECT pg_advisory_unlock(21844, 7301)');}finally{db.release();await pool.end();}
}
