/** @param {string | undefined} source */
export function isSequenceDiagram(source) {
  return /^shape:[ \t]*sequence_diagram[ \t]*(?:#.*)?$/m.test(source ?? '');
}

/** Host-only D2 comment; absent means docs-kit's default 90vh. @param {string | undefined} source */
export function sequenceViewportHeight(source) {
  if (!isSequenceDiagram(source)) return undefined;
  const directive = source?.match(/^# viewport-height:[ \t]*(.*)$/m)?.[1].trim();
  if (directive === undefined) return undefined;
  if (!/^\d{2,3}vh$/.test(directive)) throw new Error(`Invalid sequence viewport-height: ${directive}`);
  const height = Number.parseInt(directive, 10);
  if (height < 90 || height > 240) throw new Error('Sequence viewport-height must be between 90vh and 240vh');
  return `${height}vh`;
}
