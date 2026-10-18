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
    assert.equal(blocks.filter(m => m[1] === 'mermaid' && /^flowchart/m.test(m[2])).length, 0);
    assert.equal(blocks.filter(m => m[1] === 'mermaid' && /^sequenceDiagram/m.test(m[2])).length, 0);
    const sequences = blocks.filter(m => /^d2\b/.test(m[1]) && /^shape: sequence_diagram$/m.test(m[2]));
    assert.ok(sequences.length >= 2, 'core use cases must retain sequence diagrams');
    assert.equal(blocks.filter(m => m[1] === 'mermaid' && /^erDiagram/m.test(m[2])).length, 1);
    const enhanced = blocks.filter(m => /^(d2|protocol-exchange|code-walkthrough|terminal-session|span-waterfall)\b/.test(m[1]));
    assert.ok(enhanced.filter(m => m[1].startsWith('d2 ')).length >= 2);
    const prepared = rebaseDiagramIcons(enhanced.map(m => m[0]).join('\n\n'));
    const compiled = String(await compile({
      value: prepared, cwd: root, path: join(root, 'content/docs', `${slug}.md`),
    }, { remarkPlugins: plugins }));
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
  const [create, , burn] = sequences.map(m => m[2]);
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

test('all migrated sequences retain message counts, dashed responses, branches, loops and parallel labels', async () => {
  const contracts = {
    'url-shortener': [[12, 4, ['if: custom alias provided', 'else: auto generated']], [10, 3, ['if: Cache hit', 'else: Cache miss']]],
    'paste-bin': [[17, 6, []], [25, 13, ['if: CDN cache hit', 'else: CDN cache miss', 'if: Cache hit', 'else: Cache miss', 'if: Paste not found', 'else: Paste expired', 'else: Paste found']], [11, 4, ['Lần truy cập sau → 410 Gone']]],
    'chat-system': [[19, 6, ['if: User B online', 'else: User B offline']], [10, 4, ['if: Cache HIT', 'else: Cache MISS']]],
    'news-feed': [[26, 6, ['if: Post có media', 'if: Normal User (< 10K followers)', 'else: Celebrity User (≥ 10K followers)', '[K,FS] Async processing']], [26, 11, ['if: Cache HIT', 'else: Cache MISS', 'loop — lặp lại cho Each celebrity', 'if: All posts in cache', 'else: Some cache miss', 'Merge celebrity posts']]],
    'rate-limiter': [[13, 7, ['if: Tokens available', 'else: Bucket empty', 'EVALSHA dùng SHA1 hash']], [10, 4, ['par — các nhánh chạy song song, không theo thứ tự dọc', 'nhánh song song: Broadcast to all instances', 'nhánh song song: nhánh còn lại', '[GW1,GW2] New rule active within seconds']]],
  };
  for (const [slug, expected] of Object.entries(contracts)) {
    const content = await readFile(join(root, `${slug}.md`), 'utf8');
    const sequences = fences(content).filter(m => /^d2\b/.test(m[1]) && /^shape: sequence_diagram$/m.test(m[2]));
    assert.equal(sequences.length, slug === 'rate-limiter' ? 3 : expected.length);
    for (const [i, [messages, responses, labels]] of expected.entries()) {
      const source = sequences[i][2];
      assert.equal((source.match(/^\s*\w+ -> \w+:/gm) ?? []).length, messages, `${slug} flow ${i + 1}: messages`);
      assert.equal((source.match(/style.stroke-dash: 4/g) ?? []).length, responses, `${slug} flow ${i + 1}: responses/events`);
      for (const label of labels) assert.ok(source.includes(label), `${slug}: missing ${label}`);
    }
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
