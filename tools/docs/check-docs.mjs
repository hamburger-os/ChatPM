#!/usr/bin/env node
// Zero-dependency documentation structure, link, and skill-metadata check.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const required = [
  'README.md', 'AGENTS.md', 'docs/README.md',
  'docs/ai/README.md', 'docs/design/README.md',
  'docs/knowledge/README.md', 'docs/community/README.md',
  '.agents/skills/docs-sync/SKILL.md',
  '.agents/skills/architecture-review/SKILL.md',
];

function exists(rel) { return fs.existsSync(path.resolve(root, rel)); }
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

for (const file of required) if (!exists(file)) errors.push('Required file missing: ' + file);

// Enforce the four agreed documentation layers and disallow additional root folders.
const allowedDocLayers = new Set(['ai', 'community', 'design', 'knowledge']);
const docsRoot = path.join(root, 'docs');
if (fs.existsSync(docsRoot)) {
  for (const entry of fs.readdirSync(docsRoot, {withFileTypes:true})) {
    if (entry.isDirectory() && !allowedDocLayers.has(entry.name)) {
      errors.push('Unexpected docs directory outside four layers: docs/' + entry.name);
    }
  }
  for (const layer of allowedDocLayers) {
    if (!exists('docs/' + layer)) errors.push('Missing documentation layer: docs/' + layer);
  }
}


const docs = [
  ...walk(path.join(root, 'docs')),
  ...walk(path.join(root, '.agents')),
  path.join(root, 'README.md'),
  path.join(root, 'AGENTS.md'),
].filter((file) => file.endsWith('.md') && fs.existsSync(file));

for (const file of docs) {
  const body = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replaceAll(path.sep, '/');
  if (!body.trim().startsWith('#') && !body.trim().startsWith('---')) {
    errors.push('Missing heading/frontmatter: ' + rel);
  }
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].trim().replace(/^<|>$/g, '');
    if (!link || link.startsWith('#') || /^(https?:|mailto:|data:)/i.test(link)) continue;
    const relative = decodeURIComponent(link.split('#')[0].split('?')[0]);
    const target = path.resolve(path.dirname(file), relative);
    if (!fs.existsSync(target)) errors.push('Broken link: ' + rel + ' -> ' + link);
  }
}

// Community docs: one Markdown per topic, with both languages in that file.
const community = path.join(root, 'docs/community');
const topicFiles = [];
for (const entry of fs.readdirSync(community, {withFileTypes:true})) {
  if (entry.isDirectory()) {
    errors.push('Community topics must be flat bilingual Markdown files: docs/community/' + entry.name);
    continue;
  }
  if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
    topicFiles.push(entry.name);
    const body = fs.readFileSync(path.join(community, entry.name), 'utf8');
    const zh = /^## 中文\s*$/m.exec(body);
    const en = /^## English\s*$/m.exec(body);
    if (!zh || !en || zh.index >= en.index ||
        !body.slice(zh.index + zh[0].length, en.index).trim() ||
        !body.slice(en.index + en[0].length).trim()) {
      errors.push('Missing or empty bilingual sections in docs/community/' + entry.name);
    }
  }
}

const skillsRoot = path.join(root, '.agents/skills');
if (fs.existsSync(skillsRoot)) {
  for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const file = path.join(skillsRoot, skill.name, 'SKILL.md');
    if (!fs.existsSync(file)) { errors.push('Missing SKILL.md: ' + skill.name); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!match) { errors.push('Invalid skill frontmatter: ' + skill.name); continue; }
    const name = match[1].match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim();
    const desc = match[1].match(/^description:\s*([^\r\n]+)$/m)?.[1]?.trim();
    if (name !== skill.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? '')) {
      errors.push('Skill name must match directory: ' + skill.name);
    }
    if (!desc || desc.length > 1024) errors.push('Skill description invalid: ' + skill.name);
  }
}

if (errors.length) {
  for (const error of errors) console.error('ERROR: ' + error);
  console.error(errors.length + ' documentation error(s).');
  process.exit(1);
}
console.log('Documentation checks passed: ' + docs.length + ' Markdown files, '
  + topicFiles.length + ' single-file bilingual community topics.');
