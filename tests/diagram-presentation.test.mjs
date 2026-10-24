import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isSequenceDiagram, sequenceViewportHeight } from '../src/lib/diagram-presentation.mjs';

const root = new URL('../', import.meta.url);
const budgets = {
  'url-shortener': [], // The two request paths now use compact flow topology.
  'paste-bin': ['130vh', '180vh', '100vh'],
  'chat-system': ['100vh'],
  'news-feed': ['140vh', '190vh'],
  'rate-limiter': ['110vh', '180vh'],
};

test('only root sequence diagrams can opt into a per-diagram height', () => {
  assert.equal(isSequenceDiagram('shape: sequence_diagram\na -> b'), true);
  assert.equal(isSequenceDiagram('# A flow\nshape: sequence_diagram # timeline\na -> b'), true);
  const directive = '# viewport-height: 140vh\n';
  assert.equal(sequenceViewportHeight(`${directive}shape: sequence_diagram`), '140vh');
  for (const source of [undefined, '', 'db: {shape: sql_table}', 'a -> b', 'nested: {\n  shape: sequence_diagram\n}', 'note: "shape: sequence_diagram"']) {
    assert.equal(isSequenceDiagram(source), false);
    assert.equal(sequenceViewportHeight(directive + (source ?? '')), undefined);
  }
  assert.equal(sequenceViewportHeight('shape: sequence_diagram\na -> b'), undefined);
  for (const value of ['none', '100px', '10vh', '999vh', '120vh; color: red']) {
    assert.throws(() => sequenceViewportHeight(`# viewport-height: ${value}\nshape: sequence_diagram`));
  }
});

test('sequences have individual measured budgets; short flows and all ER/architecture keep defaults', async () => {
  let defaults = 0;
  let overrides = 0;
  for (const [slug, expected] of Object.entries(budgets)) {
    const content = await readFile(new URL(`${slug}.md`, root), 'utf8');
    const blocks = [...content.matchAll(/^```d2[^\n]*\n([\s\S]*?)^```/gm)];
    const sequences = [];
    for (const [, source] of blocks) {
      const height = sequenceViewportHeight(source);
      if (height) overrides++;
      else defaults++;
      if (isSequenceDiagram(source)) sequences.push(height);
      else assert.equal(height, undefined);
    }
    assert.deepEqual(sequences, expected, `${slug}: per-flow budgets`);
  }
  assert.equal(overrides, 8);
  assert.equal(defaults, 19);
  const css = await readFile(new URL('src/app/globals.css', root), 'utf8');
  assert.doesNotMatch(css, /--d2-(?:viewport|preview)-max-height\s*:/, 'no global height override');
  assert.doesNotMatch(css, /d2-sequence-frame|sequence-frame-stroke|mix-blend-mode/, 'shared presentation belongs to docs-kit');
  const packageCss = await readFile(new URL(import.meta.resolve('@vanhiep99w/docs-kit/styles/d2.css')), 'utf8');
  assert.match(packageCss, /--d2-sequence-padding, 3rem 1rem 1\.5rem/);
  assert.match(packageCss, /svg\[data-d2-sequence\]/);
  const registry = await readFile(new URL('src/mdx-components.tsx', root), 'utf8');
  assert.match(registry, /sequenceViewportHeight\(props.source\)/);
  assert.match(registry, /D2InteractiveDiagram: InteractiveDiagram/);
});
