import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDependencyOnlyPackageJsonChange } from './change-classification.mjs';

const repository = process.cwd();
const checker = resolve(repository, 'tools/docs/check-sync.mjs');

function runGit(cwd, args) {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function createRepository(packageJson) {
  const dir = mkdtempSync(join(tmpdir(), 'chatpm-check-sync-'));
  try {
    runGit(dir, ['init', '-q', '-b', 'main']);
    runGit(dir, ['config', 'user.email', 'check-sync@example.test']);
    runGit(dir, ['config', 'user.name', 'Check Sync']);
    writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
    runGit(dir, ['add', 'package.json']);
    runGit(dir, ['commit', '-q', '-m', 'base']);
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function writePackageJson(dir, packageJson) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
}

function commitPackageJson(dir, packageJson) {
  writePackageJson(dir, packageJson);
  runGit(dir, ['commit', '-q', '-am', 'change']);
}

function runChecker(cwd, base = 'HEAD~1', head = 'HEAD') {
  return spawnSync(process.execPath, [checker, base, head], { cwd, encoding: 'utf8' });
}

test('dependency version bumps are not product behavior', () => {
  assert.equal(isDependencyOnlyPackageJsonChange(
    JSON.stringify({ name: 'chatpm', dependencies: { fastify: '5.12.6' } }),
    JSON.stringify({ name: 'chatpm', dependencies: { fastify: '5.12.7' } }),
  ), true);
});

test('scripts, engines and other manifest fields remain product behavior', () => {
  const base = JSON.stringify({ name: 'chatpm', scripts: { test: 'a' } });
  assert.equal(isDependencyOnlyPackageJsonChange(
    base,
    JSON.stringify({ name: 'chatpm', scripts: { test: 'b' } }),
  ), false);
  assert.equal(isDependencyOnlyPackageJsonChange(
    JSON.stringify({ name: 'chatpm', engines: { node: '>=22' } }),
    JSON.stringify({ name: 'chatpm', engines: { node: '>=24' } }),
  ), false);
});

test('manifest key order does not create a false product change', () => {
  assert.equal(isDependencyOnlyPackageJsonChange(
    JSON.stringify({ version: '0.2.0', name: 'chatpm', dependencies: { a: '1.0.0' } }),
    JSON.stringify({ name: 'chatpm', version: '0.2.0', dependencies: { a: '1.0.1' } }),
  ), true);
});

test('check-sync exempts dependency-only package.json changes from documentation updates', () => {
  const manifest = {
    name: 'chatpm', version: '0.1.0', dependencies: { fastify: '5.12.6' },
  };
  const dir = createRepository(manifest);
  try {
    commitPackageJson(dir, { ...manifest, dependencies: { fastify: '5.12.7' } });
    const dependencyOnly = runChecker(dir);
    assert.equal(dependencyOnly.status, 0, dependencyOnly.stderr);
    assert.match(dependencyOnly.stdout, /Dependency-only root package\.json change/);

    writePackageJson(dir, { ...manifest, dependencies: { fastify: '5.12.8' } });
    mkdirSync(join(dir, 'apps'), { recursive: true });
    writeFileSync(join(dir, 'apps', 'product.txt'), 'product\n');
    runGit(dir, ['add', '.']);
    runGit(dir, ['commit', '-q', '-m', 'dependency plus product change']);
    const mixed = runChecker(dir);
    assert.equal(mixed.status, 1);
    assert.doesNotMatch(mixed.stdout, /product documentation update not required/);

    commitPackageJson(dir, {
      ...manifest, dependencies: { fastify: '5.12.8' },
      scripts: { start: 'node server.js' },
    });
    const productChange = runChecker(dir);
    assert.equal(productChange.status, 1);
    assert.match(productChange.stderr, /Product behavior change requires/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-sync compares package.json against the merge base, not the base branch tip', () => {
  const manifest = {
    name: 'chatpm', version: '0.1.0',
    dependencies: { fastify: '5.12.6' }, scripts: { start: 'node old.js' },
  };
  const dir = createRepository(manifest);
  try {
    runGit(dir, ['checkout', '-q', '-b', 'feature']);
    commitPackageJson(dir, { ...manifest, dependencies: { fastify: '5.12.7' } });

    runGit(dir, ['checkout', '-q', 'main']);
    commitPackageJson(dir, { ...manifest, scripts: { start: 'node new.js' } });

    const dependencyOnly = runChecker(dir, 'main', 'feature');
    assert.equal(dependencyOnly.status, 0, dependencyOnly.stderr);
    assert.match(dependencyOnly.stdout, /Dependency-only root package\.json change/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
