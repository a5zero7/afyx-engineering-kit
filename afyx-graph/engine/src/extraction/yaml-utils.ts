/**
 * AFYX-native lightweight, deterministic YAML reader.
 *
 * Implements a bounded, secret-safe, dependency-free YAML subset for:
 * - Docker Compose files (`docker-compose.yml`, `compose.yaml`)
 * - CI/CD workflows (GitHub Actions, GitLab CI, Azure Pipelines)
 * - OpenAPI / Swagger specifications (`openapi.yaml`, `swagger.yaml`)
 *
 * Features:
 * - Line-accurate position tracking for keys and entries.
 * - Handles nested mappings, sequences, quoted and scalar values, block comments.
 * - Fails closed gracefully without throwing unhandled exceptions.
 */

export interface YamlParseResult {
  data: any;
  lineMap: Map<string, number>; // "dot.separated.path" -> 1-based line number
  errors: string[];
}

export function parseYamlWithLocations(source: string): YamlParseResult {
  const lineMap = new Map<string, number>();
  const errors: string[] = [];

  const rawLines = source.split(/\r?\n/);
  // Pre-filter comments while preserving line indices
  interface ParsedLine {
    lineNum: number;
    indent: number;
    content: string;
    isSequenceItem: boolean;
  }

  const lines: ParsedLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNum = i + 1;

    // Check if line is empty or purely a comment
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') {
      continue;
    }

    // Strip trailing comments if not inside quotes
    let clean = stripTrailingComment(raw);
    const cleanTrimmed = clean.trim();
    if (!cleanTrimmed) continue;

    // Calculate indentation (spaces)
    const matchIndent = clean.match(/^(\s*)/);
    const indent = matchIndent ? matchIndent[1]!.length : 0;
    const content = clean.slice(indent);
    const isSequenceItem = content.startsWith('- ') || content === '-';

    lines.push({ lineNum, indent, content, isSequenceItem });
  }

  let root: any = null;

  try {
    const parsed = parseBlock(lines, 0, 0, '', lineMap);
    root = parsed.value;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    data: root,
    lineMap,
    errors,
  };
}

function stripTrailingComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

interface BlockResult {
  value: any;
  nextIndex: number;
}

function isDangerousKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function parseBlock(
  lines: Array<{ lineNum: number; indent: number; content: string; isSequenceItem: boolean }>,
  startIndex: number,
  minIndent: number,
  pathPrefix: string,
  lineMap: Map<string, number>,
): BlockResult {
  if (startIndex >= lines.length) {
    return { value: null, nextIndex: startIndex };
  }

  const firstLine = lines[startIndex]!;

  if (firstLine.isSequenceItem) {
    // Parse as sequence / array
    const arr: any[] = [];
    let idx = startIndex;
    let itemIndex = 0;

    while (idx < lines.length) {
      const line = lines[idx]!;
      if (line.indent < minIndent) break;

      if (line.isSequenceItem) {
        const itemPath = pathPrefix ? `${pathPrefix}[${itemIndex}]` : `[${itemIndex}]`;
        lineMap.set(itemPath, line.lineNum);

        const afterDash = line.content.slice(1).trim();
        if (!afterDash) {
          // Nested block under sequence item
          const nested = parseBlock(lines, idx + 1, line.indent + 1, itemPath, lineMap);
          arr.push(nested.value);
          idx = nested.nextIndex;
        } else if (isMappingLine(afterDash)) {
          // Inline mapping started on sequence line: "- key: value"
          const fakeLine = {
            lineNum: line.lineNum,
            indent: line.indent + 2,
            content: afterDash,
            isSequenceItem: false,
          };
          const subLines = [fakeLine];
          let lookahead = idx + 1;
          while (lookahead < lines.length && lines[lookahead]!.indent > line.indent) {
            subLines.push(lines[lookahead]!);
            lookahead++;
          }
          const nested = parseBlock(subLines, 0, line.indent + 2, itemPath, lineMap);
          arr.push(nested.value);
          idx = lookahead;
        } else {
          // Simple scalar value in sequence
          arr.push(parseScalar(afterDash));
          idx++;
        }
        itemIndex++;
      } else {
        // Line continuation or deeper block
        break;
      }
    }
    return { value: arr, nextIndex: idx };
  } else {
    // Parse as mapping / object
    const obj: Record<string, any> = Object.create(null);
    let idx = startIndex;

    while (idx < lines.length) {
      const line = lines[idx]!;
      if (line.indent < minIndent) break;

      const colonIndex = findKeyColonIndex(line.content);
      if (colonIndex < 0) {
        idx++;
        continue;
      }

      const rawKey = line.content.slice(0, colonIndex).trim();
      const key = cleanKey(rawKey);

      if (isDangerousKey(key)) {
        if (idx + 1 < lines.length && lines[idx + 1]!.indent > line.indent) {
          let look = idx + 1;
          while (look < lines.length && lines[look]!.indent > line.indent) {
            look++;
          }
          idx = look;
        } else {
          idx++;
        }
        continue;
      }
      const remainder = line.content.slice(colonIndex + 1).trim();
      const keyPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      lineMap.set(keyPath, line.lineNum);

      if (!remainder) {
        // Value is in deeper block
        if (idx + 1 < lines.length && lines[idx + 1]!.indent > line.indent) {
          const nested = parseBlock(lines, idx + 1, lines[idx + 1]!.indent, keyPath, lineMap);
          obj[key] = nested.value;
          idx = nested.nextIndex;
        } else {
          obj[key] = null;
          idx++;
        }
      } else if (remainder === '|' || remainder === '>') {
        // Multiline literal
        let text = '';
        let look = idx + 1;
        while (look < lines.length && lines[look]!.indent > line.indent) {
          text += lines[look]!.content + '\n';
          look++;
        }
        obj[key] = text.trimEnd();
        idx = look;
      } else if (remainder.startsWith('{') && remainder.endsWith('}')) {
        // Inline flow mapping e.g. { a: 1, b: 2 }
        obj[key] = parseFlowMapping(remainder);
        idx++;
      } else if (remainder.startsWith('[') && remainder.endsWith(']')) {
        // Inline flow sequence e.g. [a, b, c]
        obj[key] = parseFlowSequence(remainder);
        idx++;
      } else {
        // Simple scalar
        obj[key] = parseScalar(remainder);
        idx++;
      }
    }

    return { value: obj, nextIndex: idx };
  }
}

function isMappingLine(text: string): boolean {
  return findKeyColonIndex(text) >= 0;
}

function findKeyColonIndex(text: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble) {
      // Must be followed by space or end of line
      if (i === text.length - 1 || /\s/.test(text[i + 1]!)) {
        return i;
      }
    }
  }
  return -1;
}

function cleanKey(raw: string): string {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseScalar(val: string): any {
  val = val.trim();
  if (val === 'true' || val === 'True' || val === 'TRUE') return true;
  if (val === 'false' || val === 'False' || val === 'FALSE') return false;
  if (val === 'null' || val === 'Null' || val === 'NULL' || val === '~') return null;
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

function parseFlowSequence(str: string): any[] {
  const inner = str.slice(1, -1).trim();
  if (!inner) return [];
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if ((ch === '"' || ch === "'") && (!inQuote || quoteChar === ch)) {
      inQuote = !inQuote;
      quoteChar = inQuote ? ch : '';
      cur += ch;
    } else if (ch === ',' && !inQuote) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map(parseScalar);
}

function parseFlowMapping(str: string): Record<string, any> {
  const inner = str.slice(1, -1).trim();
  if (!inner) return Object.create(null);
  const obj: Record<string, any> = Object.create(null);
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if ((ch === '"' || ch === "'") && (!inQuote || quoteChar === ch)) {
      inQuote = !inQuote;
      quoteChar = inQuote ? ch : '';
      cur += ch;
    } else if (ch === ',' && !inQuote) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());

  for (const p of parts) {
    const c = findKeyColonIndex(p);
    if (c >= 0) {
      const k = cleanKey(p.slice(0, c).trim());
      if (isDangerousKey(k)) continue;
      const v = parseScalar(p.slice(c + 1).trim());
      obj[k] = v;
    }
  }
  return obj;
}
