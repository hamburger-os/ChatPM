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
  ...fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => path.join(root, entry.name)),
  ...walk(path.join(root, 'docs')),
  ...walk(path.join(root, '.agents')),
  ...walk(path.join(root, '.github')),
].filter((file) => file.endsWith('.md') && fs.existsSync(file));

// Match GitHub-style Markdown heading fragments, including repeated headings.
function titleSlug(title) {
  return title.toLowerCase()
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\x60*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim().replace(/\s/g, '-');
}
function anchorsFor(body) {
  const anchors = new Set();
  const count = new Map();
  const visible = [];
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^[ \t]{0,3}(\x60{3,}|~{3,})(.*)$/);
    if (marker) {
      const kind = marker[1][0], size = marker[1].length;
      if (!fence) fence = { kind, size };
      else if (fence.kind === kind && size >= fence.size && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    visible.push(line);
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const slug = titleSlug(heading[1]);
    const n = count.get(slug) || 0;
    anchors.add(n ? slug + '-' + n : slug);
    count.set(slug, n + 1);
  }
  for (const match of visible.join('\n').matchAll(/<a\s+[^>]*(?:id|name)=[\x22']([^\x22']+)[\x22'][^>]*>/gi))
    anchors.add(match[1].toLowerCase());
  return anchors;
}
const allAnchors = new Map(docs.map(file =>
  [file, anchorsFor(fs.readFileSync(file, 'utf8'))]));
for (const file of docs) {
  const body = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replaceAll(path.sep, '/');
  if (!body.trim().startsWith('#') && !body.trim().startsWith('---')) {
    errors.push('Missing heading/frontmatter: ' + rel);
  }
  for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = match[1].trim().replace(/^<|>$/g, '');
    if (!link || /^(https?:|mailto:|data:)/i.test(link)) continue;
    const hashAt = link.indexOf('#');
    const href = hashAt === -1 ? link : link.slice(0, hashAt);
    const fragment = hashAt === -1 ? '' : link.slice(hashAt + 1);
    let relative, anchor;
    try {
      relative = decodeURIComponent(href.split('?')[0]);
      anchor = decodeURIComponent(fragment).toLowerCase();
    } catch {
      errors.push('Invalid link encoding: ' + rel + ' -> ' + link);
      continue;
    }
    const target = relative ? path.resolve(path.dirname(file), relative) : file;
    if (!fs.existsSync(target)) errors.push('Broken link: ' + rel + ' -> ' + link);
    else if (anchor && target.endsWith('.md')) {
      const anchors = allAnchors.get(target) || anchorsFor(fs.readFileSync(target, 'utf8'));
      if (!anchors.has(anchor)) errors.push('Broken anchor: ' + rel + ' -> ' + link);
    }
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
console.log('Documentation checks passed: ' + docs.length + ' Markdown files (including root and .github), '
  + topicFiles.length + ' single-file bilingual community topics.');
