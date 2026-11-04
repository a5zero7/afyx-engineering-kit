/**
 * Blank C# conditional-compilation directives while preserving offsets.
 * Both branches remain visible to the native extractor.
 */
export function blankCsharpPreprocessorDirectives(source: string): string {
  if (source.indexOf('#') === -1) return source;
  const re = /^([ \t]*)#[ \t]*(if|elif|else|endif)\b[^\n]*/gm;
  return source.replace(re, (match, indent: string) =>
    indent + ' '.repeat(match.length - indent.length)
  );
}
