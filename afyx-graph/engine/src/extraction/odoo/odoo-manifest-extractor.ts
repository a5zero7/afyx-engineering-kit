import * as path from 'path';
import type { Edge, ExtractionError, ExtractionResult, Node, UnresolvedReference } from '../../types';
import { generateNodeId } from '../node-id';

/**
 * Safe token for Python literal expressions.
 */
interface PythonToken {
  type: 'string' | 'number' | 'boolean' | 'none' | 'punct' | 'ident';
  value: string;
  line: number;
  col: number;
}

/**
 * Lightweight safe tokenizer for Python manifest literals.
 * Explicitly rejects arbitrary execution; strips comments and parses dict/list/string literals.
 */
function tokenizePythonLiteral(source: string): { tokens: PythonToken[]; errors: ExtractionError[] } {
  const tokens: PythonToken[] = [];
  const errors: ExtractionError[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    if (!ch) break;

    // Newlines
    if (ch === '\n') {
      line++;
      col = 1;
      i++;
      continue;
    }

    // Whitespace
    if (/\s/.test(ch)) {
      col++;
      i++;
      continue;
    }

    // Comments
    if (ch === '#') {
      while (i < len && source[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Triple-quoted strings (''' or """)
    if ((ch === "'" || ch === '"') && source.slice(i, i + 3) === ch.repeat(3)) {
      const quote = ch.repeat(3);
      const startLine = line;
      const startCol = col;
      i += 3;
      col += 3;
      let val = '';
      let closed = false;
      while (i < len) {
        if (source.slice(i, i + 3) === quote) {
          closed = true;
          i += 3;
          col += 3;
          break;
        }
        if (source[i] === '\\' && i + 1 < len) {
          val += source[i + 1];
          i += 2;
          col += 2;
        } else {
          if (source[i] === '\n') {
            line++;
            col = 1;
          } else {
            col++;
          }
          val += source[i];
          i++;
        }
      }
      if (!closed) {
        errors.push({
          message: `Unterminated triple-quoted string starting at line ${startLine}`,
          line: startLine,
          column: startCol,
          severity: 'error',
          code: 'syntax_error',
        });
      }
      tokens.push({ type: 'string', value: val, line: startLine, col: startCol });
      continue;
    }

    // Single-line strings (' or ")
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const startLine = line;
      const startCol = col;
      i++;
      col++;
      let val = '';
      let closed = false;
      while (i < len && source[i] !== '\n') {
        if (source[i] === quote) {
          closed = true;
          i++;
          col++;
          break;
        }
        if (source[i] === '\\' && i + 1 < len) {
          val += source[i + 1];
          i += 2;
          col += 2;
        } else {
          val += source[i];
          i++;
          col++;
        }
      }
      if (!closed) {
        errors.push({
          message: `Unterminated string starting at line ${startLine}`,
          line: startLine,
          column: startCol,
          severity: 'error',
          code: 'syntax_error',
        });
      }
      tokens.push({ type: 'string', value: val, line: startLine, col: startCol });
      continue;
    }

    // Punctuation
    if ('{}[],:()'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, line, col });
      i++;
      col++;
      continue;
    }

    // Numbers
    if (/[\d-]/.test(ch) && (ch !== '-' || /\d/.test(source[i + 1] || ''))) {
      const startLine = line;
      const startCol = col;
      let num = '';
      while (i < len && /[\d.eE_+-]/.test(source[i]!)) {
        num += source[i]!;
        i++;
        col++;
      }
      tokens.push({ type: 'number', value: num, line: startLine, col: startCol });
      continue;
    }

    // Identifiers / Keywords (True, False, None, or dynamic expressions)
    if (/[a-zA-Z_]/.test(ch)) {
      const startLine = line;
      const startCol = col;
      let ident = '';
      while (i < len && /[a-zA-Z0-9_]/.test(source[i]!)) {
        ident += source[i]!;
        i++;
        col++;
      }
      if (ident === 'True' || ident === 'False') {
        tokens.push({ type: 'boolean', value: ident, line: startLine, col: startCol });
      } else if (ident === 'None') {
        tokens.push({ type: 'none', value: ident, line: startLine, col: startCol });
      } else {
        tokens.push({ type: 'ident', value: ident, line: startLine, col: startCol });
      }
      continue;
    }

    // Unknown character
    col++;
    i++;
  }

  return { tokens, errors };
}

type ParsedValue =
  | string
  | number
  | boolean
  | null
  | ParsedValue[]
  | { [key: string]: ParsedValue }
  | { __unsupported: string; line: number };

/**
 * Recursive descent safe parser for Python dictionary literals.
 */
class PythonLiteralParser {
  private idx = 0;
  readonly errors: ExtractionError[] = [];

  constructor(private readonly tokens: PythonToken[]) {}

  private peek(): PythonToken | undefined {
    return this.tokens[this.idx];
  }

  private next(): PythonToken | undefined {
    return this.tokens[this.idx++];
  }

  parse(): ParsedValue | null {
    if (this.tokens.length === 0) return null;
    return this.parseExpr();
  }

  private parseExpr(): ParsedValue {
    const tok = this.peek();
    if (!tok) return null;

    if (tok.type === 'string') {
      this.next();
      return tok.value;
    }
    if (tok.type === 'number') {
      this.next();
      return Number(tok.value);
    }
    if (tok.type === 'boolean') {
      this.next();
      return tok.value === 'True';
    }
    if (tok.type === 'none') {
      this.next();
      return null;
    }
    if (tok.type === 'punct' && tok.value === '{') {
      return this.parseDict();
    }
    if (tok.type === 'punct' && (tok.value === '[' || tok.value === '(')) {
      return this.parseList(tok.value === '[' ? ']' : ')');
    }

    // Dynamic identifier or unsupported construct
    this.next();
    this.errors.push({
      message: `Unsupported dynamic Python expression in manifest: '${tok.value}'`,
      line: tok.line,
      column: tok.col,
      severity: 'warning',
      code: 'unsupported_expression',
    });
    return { __unsupported: tok.value, line: tok.line };
  }

  private parseDict(): { [key: string]: ParsedValue } {
    const dict: { [key: string]: ParsedValue } = {};
    const open = this.next()!; // eat '{'

    while (this.idx < this.tokens.length) {
      const tok = this.peek();
      if (!tok) break;
      if (tok.type === 'punct' && tok.value === '}') {
        this.next(); // eat '}'
        return dict;
      }

      // Key must be string (or identifier)
      let key = '';
      if (tok.type === 'string' || tok.type === 'ident') {
        key = tok.value;
        this.next();
      } else {
        this.errors.push({
          message: `Unexpected dict key token '${tok.value}' at line ${tok.line}`,
          line: tok.line,
          column: tok.col,
          severity: 'error',
          code: 'parse_error',
        });
        this.next();
      }

      // Colon ':'
      const colon = this.peek();
      if (colon && colon.type === 'punct' && colon.value === ':') {
        this.next();
      } else {
        this.errors.push({
          message: `Expected ':' after key '${key}' at line ${tok.line}`,
          line: tok.line,
          column: tok.col,
          severity: 'error',
          code: 'parse_error',
        });
      }

      // Value
      const val = this.parseExpr();
      if (key) {
        dict[key] = val;
      }

      // Optional comma ','
      const comma = this.peek();
      if (comma && comma.type === 'punct' && comma.value === ',') {
        this.next();
      } else if (comma && comma.type === 'punct' && comma.value === '}') {
        this.next();
        return dict;
      }
    }

    this.errors.push({
      message: `Unclosed dictionary starting at line ${open.line}`,
      line: open.line,
      column: open.col,
      severity: 'error',
      code: 'syntax_error',
    });
    return dict;
  }

  private parseList(closePunct: ']' | ')'): ParsedValue[] {
    const list: ParsedValue[] = [];
    const open = this.next()!; // eat '[' or '('

    while (this.idx < this.tokens.length) {
      const tok = this.peek();
      if (!tok) break;
      if (tok.type === 'punct' && tok.value === closePunct) {
        this.next();
        return list;
      }

      const val = this.parseExpr();
      list.push(val);

      const comma = this.peek();
      if (comma && comma.type === 'punct' && comma.value === ',') {
        this.next();
      } else if (comma && comma.type === 'punct' && comma.value === closePunct) {
        this.next();
        return list;
      }
    }

    this.errors.push({
      message: `Unclosed list starting at line ${open.line}`,
      line: open.line,
      column: open.col,
      severity: 'error',
      code: 'syntax_error',
    });
    return list;
  }
}

/**
 * Extractor for Odoo module manifests (__manifest__.py / __openerp__.py).
 */
export class OdooManifestExtractor {
  private readonly filePath: string;
  private readonly source: string;
  private readonly nodes: Node[] = [];
  private readonly edges: Edge[] = [];
  private readonly unresolvedReferences: UnresolvedReference[] = [];
  private readonly errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath.replace(/\\/g, '/');
    this.source = source;
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    const { tokens, errors: lexErrors } = tokenizePythonLiteral(this.source);
    this.errors.push(...lexErrors);

    if (tokens.length === 0) {
      return {
        nodes: this.nodes,
        edges: this.edges,
        unresolvedReferences: this.unresolvedReferences,
        errors: this.errors,
        durationMs: Date.now() - startTime,
      };
    }

    const parser = new PythonLiteralParser(tokens);
    const parsed = parser.parse();
    this.errors.push(...parser.errors);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || '__unsupported' in parsed) {
      this.errors.push({
        message: 'Odoo manifest does not contain a top-level dictionary',
        line: 1,
        column: 1,
        severity: 'warning',
        code: 'invalid_manifest',
      });
      return {
        nodes: this.nodes,
        edges: this.edges,
        unresolvedReferences: this.unresolvedReferences,
        errors: this.errors,
        durationMs: Date.now() - startTime,
      };
    }

    const manifest = parsed as { [key: string]: ParsedValue };
    const dirName = path.basename(path.dirname(this.filePath)) || 'odoo_module';
    const manifestName = typeof manifest.name === 'string' ? manifest.name : dirName;
    const version = typeof manifest.version === 'string' ? manifest.version : 'unknown';
    const license = typeof manifest.license === 'string' ? manifest.license : undefined;
    const author = typeof manifest.author === 'string' ? manifest.author : undefined;
    const summary = typeof manifest.summary === 'string' ? manifest.summary : undefined;
    const description = typeof manifest.description === 'string' ? manifest.description : summary;

    const lineCount = (this.source.match(/\n/g) || []).length + 1;
    const moduleId = generateNodeId(this.filePath, 'module', dirName, 1);

    // Build module manifest node
    const moduleNode: Node = {
      id: moduleId,
      kind: 'module',
      name: manifestName,
      qualifiedName: `${dirName}::manifest`,
      filePath: this.filePath,
      language: 'python',
      startLine: 1,
      endLine: lineCount,
      startColumn: 1,
      endColumn: 1,
      signature: `module ${dirName} (version: ${version})`,
      docstring: [
        `Odoo Module: ${manifestName} (${dirName})`,
        `Version: ${version}`,
        license ? `License: ${license}` : null,
        author ? `Author: ${author}` : null,
        description ? `Description: ${description}` : null,
      ].filter(Boolean).join('\n'),
      updatedAt: Date.now(),
    };
    this.nodes.push(moduleNode);

    // Module dependencies ('depends')
    if (Array.isArray(manifest.depends)) {
      for (const item of manifest.depends) {
        if (typeof item === 'string' && item.trim()) {
          const depName = item.trim();
          this.unresolvedReferences.push({
            fromNodeId: moduleId,
            referenceName: depName,
            referenceKind: 'imports',
            line: 1,
            column: 1,
            filePath: this.filePath,
            language: 'python',
          });
        }
      }
    }

    // Declared data files ('data')
    if (Array.isArray(manifest.data)) {
      for (const item of manifest.data) {
        if (typeof item === 'string' && item.trim()) {
          const dataPath = item.trim();
          this.unresolvedReferences.push({
            fromNodeId: moduleId,
            referenceName: dataPath,
            referenceKind: 'references',
            line: 1,
            column: 1,
            filePath: this.filePath,
            language: 'python',
          });
        }
      }
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }
}
