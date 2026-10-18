import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import { remarkD2 } from '@vanhiep99w/docs-kit/d2';
import { remarkProtocolExchange } from '@vanhiep99w/docs-kit/protocol-exchange';
import { remarkCodeWalkthrough } from '@vanhiep99w/docs-kit/code-walkthrough';
import { remarkTerminalSession } from '@vanhiep99w/docs-kit/terminal-session';
import { remarkSpanWaterfall } from '@vanhiep99w/docs-kit/span-waterfall';
import { visit } from 'unist-util-visit';

// Keep Mermaid for sequence branching and ER cardinalities that D2 cannot
// express as directly. Only trusted, repository-authored diagrams are compiled.
function remarkMermaid() {
  return (tree: import('mdast').Root) => {
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'mermaid' || index === undefined || !parent) return;
      (parent.children as unknown[])[index] = {
        type: 'mdxJsxFlowElement',
        name: 'MermaidDiagram',
        attributes: [
          { type: 'mdxJsxAttribute', name: 'chart', value: node.value },
        ],
        children: [],
      };
    });
  };
}

export const docs = defineDocs({ dir: 'content/docs' });

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [
      [remarkD2, {
        layout: 'elk',
        sketch: false,
        scale: 1,
        // Local, allowlisted icons are embedded in SVG at build time.
        assetsRoot: 'diagrams/icons',
        cacheDir: '.next/cache/docs-kit/d2',
        concurrency: 1,
        defaultCaption: 'Sơ đồ hệ thống',
      }],
      remarkProtocolExchange,
      remarkCodeWalkthrough,
      remarkTerminalSession,
      remarkSpanWaterfall,
      remarkMermaid,
    ],
  },
});
