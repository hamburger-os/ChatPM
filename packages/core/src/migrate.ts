import { readFile } from 'node:fs/promises';
import { pool } from './db.ts';

const migration = new URL('../sql/001_init.sql', import.meta.url);
try {
  const text = await readFile(migration, 'utf8');
  await pool.query(text);
  console.log('Database migration complete.');
} finally {
  await pool.end();
}
