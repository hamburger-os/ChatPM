#!/usr/bin/env node
// Mechanical PR gate; semantic fidelity still requires human design review.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDependencyOnlyPackageJsonChange } from './change-classification.mjs';

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function readFileAtRevision(revision, file) {
  const result = git(['show', revision + ':' + file]);
  return result.status === 0 ? result.stdout : null;
}

function main() {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  if (!base) {
    console.error('Usage: node tools/docs/check-sync.mjs <base-ref> [head-ref]');
    process.exit(2);
  }

  const result = git([
    'diff', '--name-only', '--diff-filter=ACDMRT', base + '...' + head,
  ]);

  if (result.status !== 0) {
    console.error('Unable to compare revisions: ' + (result.stderr || result.error?.message));
    process.exit(2);
  }

  // Three-dot diff compares the merge base to head. Read package.json from the
  // same merge base so a base branch that moved ahead cannot skew classification.
  const mergeBaseResult = git(['merge-base', base, head]);
  const mergeBase = mergeBaseResult.stdout.trim();
  if (mergeBaseResult.status !== 0 || !mergeBase) {
    console.error('Unable to resolve merge base: ' +
      (mergeBaseResult.stderr || mergeBaseResult.error?.message || 'empty result'));
    process.exit(2);
  }

  const changed = result.stdout.split(/\r?\n/).filter(Boolean);
  const set = new Set(changed);
  // Deployment entry points and runtime configuration are product behavior too.
  // Next.js rewrites this generated type-reference file; it is not product behavior.
  // root package.json is classified separately: dependency-only changes are not product behavior.
  const generatedOnly = new Set(['apps/web/next-env.d.ts']);
  let productCode = changed.some((name) =>
    !generatedOnly.has(name) && name !== 'package.json' && (
    /^(apps|packages|infra|database)\//.test(name) ||
    /^(tools\/ops|tools\/build)\//.test(name) ||
    name === '.env.example'));

  let dependencyOnlyPackageJson = false;
  if (set.has('package.json')) {
    const basePackage = readFileAtRevision(mergeBase, 'package.json');
    const headPackage = readFileAtRevision(head, 'package.json');
    if (basePackage === null || headPackage === null) {
      productCode = true;
    } else {
      try {
        dependencyOnlyPackageJson = isDependencyOnlyPackageJsonChange(
          basePackage, headPackage, mergeBase, head,
        );
      } catch (error) {
        console.error('Unable to classify package.json: ' + error.message);
        process.exit(2);
      }
      if (!dependencyOnlyPackageJson) productCode = true;
    }
  }

  if (dependencyOnlyPackageJson && !productCode) {
    console.log('Dependency-only root package.json change: product documentation update not required.');
  }

  const errors = [];
  if (productCode) {
    if (!changed.some(name => /^docs\/community\/(?!README\.md$).+\.md$/.test(name))) {
      errors.push('Product behavior change requires an updated bilingual community guide.');
    }
    if (!changed.some((name) => /^docs\/design\/(?!README\.md$).+\.md$/.test(name))) {
      errors.push('Product code change requires a corresponding Chinese design module update.');
    }
    if (!changed.some((name) => /^docs\/ai\/(?!README\.md$).+\.md$/.test(name))) {
      errors.push('Product code change requires an AI engineering document update.');
    }
  }

  if (errors.length) {
    for (const error of errors) console.error('ERROR: ' + error);
    process.exit(1);
  }
  console.log('Docs-sync change gate passed (' + changed.length + ' changed files).');
  console.log('Note: automated checks do not prove architectural or translation equivalence.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
