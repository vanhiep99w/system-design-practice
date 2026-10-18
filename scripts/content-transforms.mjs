/** Rebase root-authored D2 icons for generated content/docs/*.md only. */
export function rebaseDiagramIcons(content) {
  return content.replace(/^```d2\b([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm,
    (_, meta, source) => `\`\`\`d2${meta}\n${source.replace(
      /^(\s*icon:\s*)(["']?)\.\/diagrams\/icons\/([\w-]+\.svg)\2[ \t]*$/gm,
      '$1$2../../diagrams/icons/$3$2',
    )}\`\`\``);
}
