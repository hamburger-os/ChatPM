import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const destination = join('dist', 'packages', 'core', 'sql');
mkdirSync(destination, { recursive: true });
cpSync(join('packages', 'core', 'sql'), destination, { recursive: true });
console.log('Packaged SQL migrations:', destination);
