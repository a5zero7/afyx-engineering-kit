/** Ensure the native grammar input has the terminator expected by VB.NET. */
export function ensureTrailingNewline(source: string): string {
  return source.endsWith('\n') ? source : source + '\n';
}
