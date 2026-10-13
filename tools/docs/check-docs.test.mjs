import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repository = process.cwd();
const checker = resolve(repository, 'tools/docs/check-docs.mjs');

function runChecker(cwd) {
  return spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
}

test('documentation check detects broken root-document links and missing anchors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chatpm-docs-check-'));
  try {
    // Only tracked files are copied: never include node_modules or credentials.
    const tracked = spawnSync('git', ['ls-files', '-z'], {
      cwd: repository, encoding: 'utf8',
    });
    assert.equal(tracked.status, 0, tracked.stderr);
    for (const file of tracked.stdout.split('\0').filter(Boolean)) {
      const target = join(dir, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repository, file), target);
    }
    const support = join(dir, 'SUPPORT.md');
    const readme = join(dir, 'README.md');
    const originalSupport = readFileSync(support, 'utf8');
    const originalReadme = readFileSync(readme, 'utf8');
    assert.equal(runChecker(dir).status, 0, 'fixture must initially pass');

    appendFileSync(support, '\n[obsolete](docs/community/zh/development.md)\n');
    const brokenLink = runChecker(dir);
    assert.equal(brokenLink.status, 1);
    assert.match(brokenLink.stderr, /Broken link: SUPPORT\.md/);

    writeFileSync(support, originalSupport);
    appendFileSync(readme, '\n[unknown section](docs/community/development.md#section-does-not-exist)\n');
    const brokenAnchor = runChecker(dir);
    assert.equal(brokenAnchor.status, 1);
    assert.match(brokenAnchor.stderr, /Broken anchor: README\.md/);

    writeFileSync(readme, originalReadme);
    appendFileSync(readme, '\n~~~sh\n## Hidden inside tilde fence\n~~~\n' +
      '[fake heading](README.md#hidden-inside-tilde-fence)\n');
    const hiddenHeading = runChecker(dir);
    assert.equal(hiddenHeading.status, 1);
    assert.match(hiddenHeading.stderr, /Broken anchor: README\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
