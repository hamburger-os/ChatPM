import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const required = [
  'dist/apps/api/src/server.js',
  'dist/apps/worker/src/worker.js',
  'dist/packages/core/src/migrate.js',
  'dist/packages/core/sql/001_init.sql',
  'dist/packages/core/sql/002_reliability.sql',
  'dist/packages/core/sql/003_integrity_sessions.sql',
  'apps/web/.next/BUILD_ID',
];
for (const file of required) assert.ok(existsSync(file), 'Missing distribution file: ' + file);
assert.match(readFileSync('dist/packages/core/src/migrate.js','utf8'), /sql\//);
console.log('Production distribution files verified.');
