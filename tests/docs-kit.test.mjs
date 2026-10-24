import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { compile } from '@mdx-js/mdx';
import { remarkD2 } from '@vanhiep99w/docs-kit/d2';
import { remarkProtocolExchange, parseProtocolExchangeDescriptor } from '@vanhiep99w/docs-kit/protocol-exchange';
import { protocolBodySource } from '@vanhiep99w/docs-kit/protocol-exchange/data';
import { remarkCodeWalkthrough } from '@vanhiep99w/docs-kit/code-walkthrough';
import { remarkTerminalSession } from '@vanhiep99w/docs-kit/terminal-session';
import { remarkSpanWaterfall } from '@vanhiep99w/docs-kit/span-waterfall';
import { rebaseDiagramIcons } from '../scripts/content-transforms.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const designs = ['url-shortener', 'paste-bin', 'chat-system', 'news-feed', 'rate-limiter'];
const plugins = [
  [remarkD2, {
    layout: 'tala', sketch: false, scale: 1, assetsRoot: 'diagrams/icons',
    cacheDir: '.next/cache/docs-kit/d2', concurrency: 1,
  }],
  remarkProtocolExchange, remarkCodeWalkthrough,
  remarkTerminalSession, remarkSpanWaterfall,
];
const fences = (content) => [...content.matchAll(/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm)];

test('rebase only D2 icon declarations, preserving metadata and other samples', () => {
  const source = [
    '```d2 interactive title="API"',
    'api: API {',
    '  icon: ./diagrams/icons/eks.svg',
    '}',
    'db.icon: https://icons.d2lang.com/example.svg',
    '```',
    '```java',
    'icon: ./diagrams/icons/eks.svg',
    '```',
    '```d2',
    'icon: "./diagrams/icons/rds.svg"',
    '```',
  ].join('\n');
  const rebased = rebaseDiagramIcons(source);
  assert.ok(rebased.includes('```d2 interactive title="API"'));
  assert.ok(rebased.includes('  icon: ../../diagrams/icons/eks.svg'));
  assert.ok(rebased.includes('icon: "../../diagrams/icons/rds.svg"'));
  assert.ok(rebased.includes('```java\nicon: ./diagrams/icons/eks.svg\n```'));
  assert.ok(rebased.includes('https://icons.d2lang.com/example.svg'));
  assert.equal(rebaseDiagramIcons(rebased), rebased);
});

for (const slug of designs) {
  test(`${slug}: preserve blueprint, compile all docs-kit fences and local icons`, async () => {
    const content = await readFile(join(root, `${slug}.md`), 'utf8');
    const sections = [...content.matchAll(/^## (\d+)\./gm)].map(m => Number(m[1]));
    assert.deepEqual(sections, Array.from({ length: 17 }, (_, i) => i + 1));
    const blocks = fences(content);
    assert.equal(blocks.filter(m => m[1] === 'mermaid').length, 0, 'all diagrams use build-time D2');
    const requestViews = blocks.filter(m => /^d2\b/.test(m[1]) && (/^shape: sequence_diagram$/m.test(m[2]) || /\bmode=flow\b/.test(m[1])));
    assert.ok(requestViews.length >= 2, 'core use cases need sequence or authored request-flow views');
    assert.equal(blocks.filter(m => /^d2\b/.test(m[1]) && /shape: sql_table/m.test(m[2])).length, 1);
    const enhanced = blocks.filter(m => /^(d2|protocol-exchange|code-walkthrough|terminal-session|span-waterfall)\b/.test(m[1]));
    assert.ok(enhanced.filter(m => m[1].startsWith('d2 ')).length >= 2);
    const prepared = rebaseDiagramIcons(enhanced.map(m => m[0]).join('\n\n'));
    let tree;
    const capture = () => result => { tree = result; };
    const compiled = String(await compile({
      value: prepared, cwd: root, path: join(root, 'content/docs', `${slug}.md`),
    }, { remarkPlugins: [...plugins, capture] }));
    const attribute = (node, name) => {
      const value = node.attributes.find(a => a.name === name).value;
      if (typeof value === 'string') return value;
      const expression = value.data.estree.body[0].expression;
      return expression.type === 'Literal' ? expression.value : JSON.parse(expression.arguments[0].value);
    };
    for (const node of tree.children.filter(n => n.name === 'D2InteractiveDiagram')) {
      const source = attribute(node, 'source');
      if (/^# @flow$/m.test(source)) {
        assert.equal(attribute(node, 'mode'), 'flow');
        const flow = attribute(node, 'flow');
        const scenario = id => {
          const found = flow.scenarios.find(item => item.id === id);
          assert.ok(found, `${slug}: missing ${id} scenario`);
          return found;
        };
        const visits = (id, actor) => scenario(id).steps.some(step => step.from === actor || step.to === actor);
        const caption = attribute(node, 'caption');
        if (slug === 'chat-system' || (slug === 'url-shortener' && caption.includes('Redirect'))) {
          const database = slug === 'chat-system' ? 'DB' : 'P';
          assert.equal(visits('hit', database), false, 'cache hit must skip the database');
          assert.equal(visits('miss', database), true, 'cache miss must query the database');
          assert.ok(scenario('miss').steps.some(step => /SET/.test(step.description)), 'miss must populate cache');
        }
        if (slug === 'url-shortener' && caption.includes('Tạo short URL')) {
          assert.equal(visits('alias', 'I'), false, 'custom alias does not allocate a Snowflake ID');
          assert.equal(visits('generated', 'I'), true);
          assert.ok(scenario('alias').steps.some(step => /alias còn trống/.test(step.description)));
        }
        if (slug === 'rate-limiter') {
          assert.equal(visits('allowed', 'SVC'), true);
          assert.equal(visits('denied', 'SVC'), false, '429 must not reach the backend');
          assert.equal(visits('allowed', 'K'), false, 'allowed request does not publish a violation');
          assert.ok(scenario('denied').steps.some(step => /429/.test(step.description)));
        }
      }
      const frames = [...source.matchAll(/^\s*(?:group_\d+|atomic): "[^"\n]+" \{$/gm)].length;
      if (!frames) continue;
      assert.doesNotMatch(source, /fill: transparent|stroke: "#64748b"|stroke-width: 2/, 'use package frame defaults, not per-page copies');
      for (const [theme, color] of [['lightSvg', '#64748b'], ['darkSvg', '#94a3b8']]) {
        const svg = attribute(node, theme);
        assert.match(svg, /data-d2-sequence="true"/);
        assert.match(svg, /mix-blend-mode:normal;opacity:1/);
        const borders = svg.match(new RegExp(`<(?:rect|path)\\b[^>]*stroke="${color}"[^>]*fill="transparent"[^>]*style="[^"]*stroke-width:2;`, 'g')) ?? [];
        assert.equal(borders.length, frames, `${slug}: every frame needs an actual SVG border in ${theme}`);
      }
    }
    assert.ok(compiled.includes('D2InteractiveDiagram'));
    assert.ok(compiled.includes('ProtocolExchange'));
    assert.ok(compiled.includes('CodeWalkthrough'));
    assert.ok(compiled.includes('data:image/svg+xml;base64,'), 'icons must be embedded, not fetched by readers');
    assert.ok(!compiled.includes('https://icons.d2lang.com/'));
    if (slug === 'rate-limiter') assert.ok(compiled.includes('TerminalSession'));
    if (slug === 'url-shortener') assert.ok(compiled.includes('SpanWaterfall'));
  });
}

test('paste-bin: D2 sequences preserve ordered messages, responses and burn-after-read note', async () => {
  const content = await readFile(join(root, 'paste-bin.md'), 'utf8');
  const sequences = fences(content).filter(m => /^d2\b/.test(m[1]) && /^shape: sequence_diagram$/m.test(m[2]));
  assert.equal(sequences.length, 3);
  const [create, , burn] = sequences.map(m => m[2].replace(/\\n/g, ' '));
  const ordered = (source, messages) => {
    let position = -1;
    for (const message of messages) {
      const next = source.indexOf(message);
      assert.ok(next > position, `missing or out-of-order message: ${message}`);
      position = next;
    }
  };
  assert.equal((create.match(/^\s*\w+ -> \w+:/gm) ?? []).length, 17);
  assert.equal((burn.match(/^\s*\w+ -> \w+:/gm) ?? []).length, 11);
  assert.equal((create.match(/style.stroke-dash: 4/g) ?? []).length, 6);
  assert.equal((burn.match(/style.stroke-dash: 4/g) ?? []).length, 4);
  ordered(create, [
    'PS -> S3: "PUT pastes/{short_code} (compressed content)"',
    'PS -> DB: "INSERT paste_metadata',
    'PS -> CACHE: "SET paste:{short_code}',
    'PS -> K: "Publish PasteCreatedEvent (async)"',
    'PS -> GW: "201 Created',
    'GW -> U: "201 Created"',
  ]);
  ordered(burn, [
    'RS -> DB: "SELECT * FROM paste_metadata WHERE short_code = ? FOR UPDATE"',
    'RS -> S3: "GET pastes/{short_code}"',
    "RS -> DB: \"UPDATE paste_metadata SET status = 'BURNED', read_count = 1\"",
    'RS -> S3: "DELETE pastes/{short_code}"',
    'RS -> CACHE: "DEL paste:{shortCode}"',
    'RS -> GW: "200 OK {content, burned: true}"',
    'GW -> U: "200 OK (lần truy cập duy nhất)"',
    'U."Lần truy cập sau → 410 Gone"',
  ]);
});

test('request views retain messages and responses; alternatives use frames or flow scenarios', async () => {
  const contracts = {
    'url-shortener': [[12, 4, ['Custom alias còn trống', 'Sinh short code']], [10, 3, ['Redis hit (edge miss/bypass)', 'Redis miss (edge miss/bypass)']]],
    'paste-bin': [[17, 6, []], [25, 13, ['if: CDN cache hit', 'else: CDN cache miss', 'if: Cache hit', 'else: Cache miss', 'if: Paste not found', 'else: Paste expired', 'else: Paste found']], [11, 4, ['Lần truy cập sau → 410 Gone']]],
    'chat-system': [[19, 6, ['if: User B online', 'else: User B offline']], [10, 4, ['Cache hit', 'Cache miss']]],
    'news-feed': [[26, 6, ['if: Post có media', 'if: Normal User (< 10K followers)', 'else: Celebrity User (≥ 10K followers)', '[K,FS] Async processing']], [26, 11, ['if: Cache HIT', 'else: Cache MISS', 'loop — lặp lại cho Each celebrity', 'if: All posts in cache', 'else: Some cache miss', 'Merge celebrity posts']]],
    'rate-limiter': [[13, 7, ['Còn token: cho phép', 'Hết token: từ chối', 'EVALSHA dùng SHA1 hash']], [10, 4, ['par — các nhánh chạy song song, không theo thứ tự dọc', 'nhánh song song: Broadcast to all instances', 'nhánh song song: nhánh còn lại', '[GW1,GW2] New rule active within seconds']]],
  };
  for (const [slug, expected] of Object.entries(contracts)) {
    const content = await readFile(join(root, `${slug}.md`), 'utf8');
    const sequences = fences(content).filter(m => /^d2\b/.test(m[1]) && (/^shape: sequence_diagram$/m.test(m[2]) || /\bmode=flow\b/.test(m[1])));
    assert.equal(sequences.length, slug === 'rate-limiter' ? 3 : expected.length);
    for (const [i, [messages, responses, labels]] of expected.entries()) {
      const source = sequences[i][2].replace(/\\n/g, ' ');
      assert.equal((source.match(/^\s*\w+ -> \w+:/gm) ?? []).length, messages, `${slug} flow ${i + 1}: messages`);
      assert.equal((source.match(/style.stroke-dash: 4/g) ?? []).length, responses, `${slug} flow ${i + 1}: responses/events`);
      for (const label of labels) assert.ok(source.includes(label), `${slug}: missing ${label}`);
    }
  }
});

test('D2 ER diagrams preserve every table, column, type, key marker and crow’s-foot relationship', async () => {
  // Snapshot of the pre-migration ER schema; row endpoints resolve the existing logical relationships.
  const contracts = JSON.parse(await readFile(join(root, 'tests/fixtures/er-contracts.json'), 'utf8'));
  const markers = { primary_key: 'PK', foreign_key: 'FK', unique: 'UK' };
  for (const slug of designs) {
    const content = await readFile(join(root, `${slug}.md`), 'utf8');
    const er = fences(content).find(m => /^d2\b/.test(m[1]) && /shape: sql_table/m.test(m[2]))[2];
    const tables = {};
    for (const [, table, fields] of er.matchAll(/^(\w+): \{\n  shape: sql_table\n([\s\S]*?)^\}/gm)) {
      tables[table] = {};
      for (const [, name, type, constraint] of fields.matchAll(/^  "([^"]+)": (\w+)(?: \{constraint: ([^}]+)\})?$/gm)) {
        const keys = constraint?.replace(/[\[\]]/g, '').split(';').map(c => markers[c.trim()]);
        if (keys) assert.ok(keys.every(Boolean), `${slug}: unknown key marker`);
        tables[table][name] = type + (keys ? ` ${keys.join(',')}` : '');
      }
    }
    const edges = [...er.matchAll(/^(\w+\."[^"]+") <-> (\w+\."[^"]+"): "([^"]+)" \{\n  source-arrowhead: "1" \{shape: (\S+)\}\n  target-arrowhead: "(0\.\.N|0\.\.1)" \{shape: (\S+)\}\n\}/gm)]
      .map(([, source, target, label, sourceShape, cardinality, targetShape]) => {
        assert.equal(sourceShape, 'cf-one-required');
        assert.equal(targetShape, cardinality === '0..N' ? 'cf-many' : 'cf-one');
        return { source, target, label, sourceShape, targetShape };
      });
    assert.deepEqual(tables, contracts[slug].tables, `${slug}: table/column/key contract`);
    assert.deepEqual(edges, contracts[slug].edges, `${slug}: relationship endpoints and cardinalities`);
  }
});

test('D2-only integration does not retain the Mermaid browser renderer', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies.mermaid, undefined);
  assert.equal(manifest.dependencies['unist-util-visit'], undefined);
  for (const path of ['source.config.ts', 'src/mdx-components.tsx']) {
    assert.doesNotMatch(await readFile(join(root, path), 'utf8'), /Mermaid/);
  }
});

test('chat HTTP examples preserve numeric IDs without Number rounding', async () => {
  const content = await readFile(join(root, 'chat-system.md'), 'utf8');
  const exchanges = fences(content).filter(m => m[1] === 'protocol-exchange')
    .map(m => parseProtocolExchangeDescriptor(m[2]));
  const bodies = exchanges.flatMap(e => e.variants.map(v => protocolBodySource(v.response.body))).join('\n');
  assert.ok(bodies.includes('7185492039184713750'));
  assert.ok(bodies.includes('7185492039184713780'));
});

test('protocol examples retain redirect, raw text and idempotency headers', async () => {
  const load = async slug => fences(await readFile(join(root, `${slug}.md`), 'utf8'))
    .filter(m => m[1] === 'protocol-exchange').flatMap(m => parseProtocolExchangeDescriptor(m[2]).variants);
  const urls = await load('url-shortener');
  const redirect = urls.find(v => v.response.status === 301);
  assert.ok(redirect.response.headers.some(h => h.name === 'Location'));
  assert.equal(redirect.response.body, undefined);
  assert.ok(urls.some(v => v.request.headers?.some(h => h.name === 'Idempotency-Key')));
  const pastes = await load('paste-bin');
  assert.ok(pastes.some(v => v.response.body?.kind === 'text' && v.response.body.text.includes('def quick_sort(arr):')));
});

test('malformed descriptors fail the MDX build instead of silently rendering empty content', async () => {
  await assert.rejects(compile('```protocol-exchange\ntitle: Invalid\nvariants: []\n```', {
    remarkPlugins: [remarkProtocolExchange],
  }));
  await assert.rejects(compile('```d2 layout=unknown\na -> b\n```', {
    remarkPlugins: [[remarkD2, { cacheDir: '.next/cache/docs-kit/d2' }]],
  }));
});
