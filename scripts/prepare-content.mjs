#!/usr/bin/env node

/**
 * Prepare System Design markdown files for Fumadocs.
 *
 * 1. For each source .md file: add YAML frontmatter, strip H1 title line
 * 2. Copy processed files into content/docs/
 * 3. Write content/docs/meta.json for sidebar order (only if not exists)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const docsBase = join(ROOT, 'content', 'docs');

// ── Source files (in sidebar order) ───────────────────────────────────────────
const DESIGNS = [
  { file: 'url-shortener.md' },
  { file: 'paste-bin.md' },
  { file: 'chat-system.md' },
  { file: 'news-feed.md' },
  { file: 'rate-limiter.md' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Extract title from first H1 heading */
function extractTitle(content) {
  const match = content.match(/^# (.+)$/m);
  return match ? match[1].trim() : '';
}

/** Extract description from first bullet item under section 1 */
function extractDescription(content) {
  // Try first list item in the problem statement (## 1. ...)
  const sectionMatch = content.match(/^## 1\..*\n([\s\S]*?)(?=\n## )/m);
  if (sectionMatch) {
    const bulletMatch = sectionMatch[1].match(/^- (.+)$/m);
    if (bulletMatch) return bulletMatch[1].trim();
  }
  // Fallback: first non-empty line after H1
  const lines = content.split('\n');
  let pastH1 = false;
  for (const line of lines) {
    if (!pastH1) {
      if (line.startsWith('# ')) pastH1 = true;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
      return trimmed.replace(/^[-*]\s+/, '').substring(0, 160);
    }
  }
  return '';
}

// ── Process each file ──────────────────────────────────────────────────────────

mkdirSync(docsBase, { recursive: true });

const slugs = [];

for (const { file } of DESIGNS) {
  const srcPath = join(ROOT, file);
  if (!existsSync(srcPath)) {
    console.warn(`  SKIP (not found): ${file}`);
    continue;
  }

  let content = readFileSync(srcPath, 'utf8');

  const title = extractTitle(content);
  const description = extractDescription(content);

  // Build frontmatter
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    '---',
  ].join('\n');

  // Remove H1 title line (Fumadocs renders it from frontmatter)
  content = content.replace(/^# .+\n+/, '');

  const finalContent = frontmatter + '\n\n' + content.trimStart();

  const destPath = join(docsBase, file);
  writeFileSync(destPath, finalContent, 'utf8');

  const slug = file.replace(/\.md$/, '');
  slugs.push(slug);
  console.log(`  ✓ ${file} → content/docs/`);
}

// ── Write root meta.json (sidebar order) — never overwrite ────────────────────

const metaPath = join(docsBase, 'meta.json');
if (!existsSync(metaPath)) {
  writeFileSync(metaPath, JSON.stringify({ pages: slugs }, null, 2), 'utf8');
  console.log(`  ✓ content/docs/meta.json created`);
} else {
  console.log(`  ~ content/docs/meta.json already exists, skipping`);
}

console.log('\nDone! Files written to content/docs/');
