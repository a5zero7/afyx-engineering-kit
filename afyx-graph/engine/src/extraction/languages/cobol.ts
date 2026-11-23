/** Make single-line DB2 INCLUDE statements grammar-safe without shifting offsets. */
function terminateSqlIncludes(source: string): string {
  const lineRe = /^([ \t]*(?:[0-9]{6})?[ \t]+EXEC\s+SQL\s+INCLUDE\s+[A-Za-z0-9$#@-]+\s+END-EXEC)([ \t]|$)/i;
  return source
    .split('\n')
    .map((line) => {
      if (!/END-EXEC/i.test(line) || /END-EXEC\s*\./i.test(line)) return line;
      const match = lineRe.exec(line);
      if (!match) return line;
      const head = match[1]!;
      return match[2] === '' ? head + '.' : head + '.' + line.slice(head.length + 1);
    })
    .join('\n');
}

/** Normalize free-format COBOL for the native grammar while preserving lines. */
export function preParseCobolSource(source: string): string {
  const marker =
    /^([ \t]*)(IDENTIFICATION\s+DIVISION|ID\s+DIVISION|PROGRAM-ID\b|\d{2}[ \t]+[A-Za-z])/i;
  let freeFormat = false;
  for (const line of source.split(/\r?\n/)) {
    const match = marker.exec(line);
    if (!match) continue;
    freeFormat = match[1]!.length < 7;
    break;
  }
  if (!freeFormat) return terminateSqlIncludes(source);
  return terminateSqlIncludes(
    source
      .split('\n')
      .map((line, index) => {
        if (index === 0) return 'CGWIDE ' + line;
        return line.length > 0 ? '       ' + line : line;
      })
      .join('\n')
  );
}
