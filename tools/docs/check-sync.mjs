#!/usr/bin/env node
// Mechanical PR gate; semantic fidelity still requires human design review.
import { spawnSync } from 'node:child_process';

const [base, head = 'HEAD'] = process.argv.slice(2);
if (!base) {
  console.error('Usage: node tools/docs/check-sync.mjs <base-ref> [head-ref]');
  process.exit(2);
}

const result = spawnSync('git', [
  'diff', '--name-only', '--diff-filter=ACDMRT', base + '...' + head,
], { encoding: 'utf8' });

if (result.status !== 0) {
  console.error('Unable to compare revisions: ' + (result.stderr || result.error?.message));
  process.exit(2);
}

const changed = result.stdout.split(/\r?\n/).filter(Boolean);
const set = new Set(changed);
const productCode = changed.some((name) => /^(apps|packages|infra|database)\//.test(name));
const errors = [];

if (productCode) {
  if (!changed.some((name) => /^docs\/design\/(?!README\.md$).+\.md$/.test(name))) {
    errors.push('Product code change requires a corresponding Chinese design module update.');
  }
  if (!changed.some((name) => /^docs\/ai\/(?!README\.md$).+\.md$/.test(name))) {
    errors.push('Product code change requires an AI engineering document update.');
  }
}

for (const name of changed) {
  const match = name.match(/^docs\/community\/(zh|en)\/(.+\.md)$/);
  if (!match) continue;
  const other = 'docs/community/' + (match[1] === 'zh' ? 'en' : 'zh') + '/' + match[2];
  if (!set.has(other)) errors.push('Community translation must change in the same PR: ' + other);
}

if (errors.length) {
  for (const error of errors) console.error('ERROR: ' + error);
  process.exit(1);
}
console.log('Docs-sync change gate passed (' + changed.length + ' changed files).');
console.log('Note: automated checks do not prove architectural or translation equivalence.');
