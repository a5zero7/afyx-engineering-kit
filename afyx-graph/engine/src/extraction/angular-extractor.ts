/**
 * AFYX Engineering Kit — Native Angular Semantic Extractor
 *
 * Lightweight, deterministic TypeScript semantic extraction route for Angular
 * applications without introducing Tree-sitter WASM or external parser deps.
 *
 * Extracts:
 * - Class decorators: @Component, @Injectable, @NgModule, @Directive, @Pipe
 * - Member decorators: @Input, @Output
 * - Component selectors, inline templates, external templateUrl references
 * - Standalone component imports and NgModule declarations/imports/exports/providers
 * - Dependency injection via constructor parameters and `inject(...)`
 * - Static Angular routing (Routes / RouterModule.forRoot|forChild / provideRouter)
 *
 * Safety:
 * - Dynamic/unresolvable metadata is recorded honestly as unresolved references.
 * - Malformed files degrade safely without throwing.
 * - Non-Angular TypeScript files emit zero Angular nodes/references.
 */

import * as path from 'path';
import type { Edge, ExtractionError, ExtractionResult, Node, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';
import { stripCommentsForRegex } from '../resolution/strip-comments';

const ANGULAR_CLASS_DECORATORS = ['Component', 'Injectable', 'NgModule', 'Directive', 'Pipe'] as const;
const ANGULAR_SIGNAL_RE = /@(?:Component|Injectable|NgModule|Directive|Pipe|Input|Output)\s*\(|from\s+['"]@angular\/(?:core|router|common)['"]|provideRouter\s*\(|RouterModule\.for(?:Root|Child)\s*\(/;

interface ParsedDecorator {
  name: string;
  args: string;
  index: number;
  end: number;
  line: number;
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function parseBalanced(
  source: string,
  openIndex: number,
  openChar: string,
  closeChar: string,
): { body: string; end: number } | null {
  if (source[openIndex] !== openChar) return null;
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return { body: source.slice(openIndex + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function scanDecorators(source: string, names: readonly string[]): ParsedDecorator[] {
  const out: ParsedDecorator[] = [];
  const re = new RegExp(`@(${names.join('|')})\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const balanced = parseBalanced(source, openIdx, '(', ')');
    if (!balanced) continue;
    out.push({
      name: m[1]!,
      args: balanced.body,
      index: m.index,
      end: balanced.end,
      line: lineNumberAt(source, m.index),
    });
    re.lastIndex = balanced.end;
  }
  return out;
}

function extractStringProp(objBody: string, propName: string): { value?: string; dynamic: boolean } {
  const propRe = new RegExp(`\\b${propName}\\s*:\\s*([^,}\\n]+)`, 'm');
  const m = objBody.match(propRe);
  if (!m) return { dynamic: false };
  const rhs = m[1]!.trim();
  const strMatch = rhs.match(/^['"`]([^'"`]+)['"`]$/);
  if (strMatch) {
    return { value: strMatch[1]!, dynamic: false };
  }
  return { dynamic: true };
}

function extractBooleanProp(objBody: string, propName: string): boolean | undefined {
  const m = objBody.match(new RegExp(`\\b${propName}\\s*:\\s*(true|false)\\b`));
  if (!m) return undefined;
  return m[1] === 'true';
}

function extractArrayIdentifiers(
  objBody: string,
  propName: string,
): { identifiers: string[]; hasDynamic: boolean } {
  const propRe = new RegExp(`\\b${propName}\\s*:\\s*\\[`, 'm');
  const m = propRe.exec(objBody);
  if (!m) {
    const dynRe = new RegExp(`\\b${propName}\\s*:\\s*([A-Za-z_$][\\w$.()]+)`, 'm');
    if (dynRe.test(objBody)) {
      return { identifiers: [], hasDynamic: true };
    }
    return { identifiers: [], hasDynamic: false };
  }
  const openBracket = m.index + m[0].length - 1;
  const balanced = parseBalanced(objBody, openBracket, '[', ']');
  if (!balanced) return { identifiers: [], hasDynamic: true };

  const identifiers: string[] = [];
  let hasDynamic = false;
  const items = balanced.body.split(',');
  for (const rawItem of items) {
    const item = rawItem.trim();
    if (!item) continue;
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(item)) {
      identifiers.push(item);
    } else if (/^\.\.\./.test(item) || /\(/.test(item)) {
      hasDynamic = true;
    }
  }
  return { identifiers, hasDynamic };
}

function findFollowingClassName(source: string, afterIndex: number): { name: string; line: number } | null {
  const tail = source.slice(afterIndex, afterIndex + 600);
  const classMatch = tail.match(/(?:^|\s)(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
  if (!classMatch) return null;
  const absIndex = afterIndex + (classMatch.index ?? 0);
  return {
    name: classMatch[1]!,
    line: lineNumberAt(source, absIndex),
  };
}

export class AngularExtractor {
  private readonly filePath: string;
  private readonly source: string;
  private readonly fileNodeId: string;
  private readonly nodes: Node[] = [];
  private readonly edges: Edge[] = [];
  private readonly unresolvedReferences: UnresolvedReference[] = [];
  private readonly errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
    this.fileNodeId = generateNodeId(this.filePath, 'file', this.filePath, 1);
  }

  extract(): ExtractionResult {
    const startTime = Date.now();

    try {
      if (!ANGULAR_SIGNAL_RE.test(this.source)) {
        return {
          nodes: [],
          edges: [],
          unresolvedReferences: [],
          errors: [],
          durationMs: Date.now() - startTime,
        };
      }

      const cleaned = stripCommentsForRegex(this.source, 'typescript');
      this.extractDecoratedClasses(cleaned);
      this.extractInputOutputDecorators(cleaned);
      this.extractDependencyInjection(cleaned);
      this.extractAngularRoutes(cleaned);
    } catch (error) {
      this.errors.push({
        message: `Angular extraction warning: ${error instanceof Error ? error.message : String(error)}`,
        filePath: this.filePath,
        severity: 'warning',
      });
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private addRef(
    fromNodeId: string,
    name: string,
    kind: UnresolvedReference['referenceKind'],
    line: number,
    relationTag: string,
  ): void {
    this.unresolvedReferences.push({
      fromNodeId,
      filePath: this.filePath,
      language: 'typescript',
      referenceName: name,
      referenceKind: kind,
      line,
      column: 0,
      candidates: [`angular:${relationTag}`],
    });
  }

  private extractDecoratedClasses(cleaned: string): void {
    const decorators = scanDecorators(cleaned, ANGULAR_CLASS_DECORATORS);

    for (const dec of decorators) {
      const targetClass = findFollowingClassName(cleaned, dec.end);
      if (!targetClass) continue;

      const args = dec.args.trim();

      if (dec.name === 'Component') {
        const compId = generateNodeId(this.filePath, 'component', targetClass.name, targetClass.line);
        const selector = extractStringProp(args, 'selector');
        const templateUrl = extractStringProp(args, 'templateUrl');
        const standalone = extractBooleanProp(args, 'standalone');
        const imports = extractArrayIdentifiers(args, 'imports');
        const hasInlineTemplate = /\btemplate\s*:/.test(args);

        const decTags = [`@Component`];
        if (selector.value) decTags.push(`selector:${selector.value}`);
        if (standalone !== undefined) decTags.push(`standalone:${standalone}`);
        if (templateUrl.value) decTags.push(`templateUrl:${templateUrl.value}`);
        if (hasInlineTemplate) decTags.push(`inlineTemplate:true`);

        if (templateUrl.value) {
          const resolvedRel = path.posix.normalize(
            path.posix.join(path.posix.dirname(this.filePath.replace(/\\/g, '/')), templateUrl.value),
          );
          this.addRef(compId, resolvedRel, 'references', dec.line, 'templateUrl');
        } else if (templateUrl.dynamic) {
          this.addRef(compId, `${targetClass.name}.templateUrl`, 'references', dec.line, 'unresolved:dynamic_templateUrl');
        }

        for (const imp of imports.identifiers) {
          this.addRef(compId, imp, 'references', dec.line, 'standalone_import');
        }
        if (imports.hasDynamic) {
          this.addRef(compId, `${targetClass.name}.imports`, 'references', dec.line, 'unresolved:dynamic_imports');
        }

        this.nodes.push({
          id: compId,
          kind: 'component',
          name: targetClass.name,
          qualifiedName: `${this.filePath}::${targetClass.name}`,
          filePath: this.filePath,
          language: 'typescript',
          startLine: targetClass.line,
          endLine: targetClass.line,
          startColumn: 0,
          endColumn: 0,
          isExported: true,
          decorators: decTags,
          docstring: JSON.stringify({
            framework: 'angular',
            decorator: 'Component',
            selector: selector.value,
            standalone,
            templateUrl: templateUrl.value,
            hasInlineTemplate,
          }),
          updatedAt: Date.now(),
        });
      } else if (dec.name === 'NgModule') {
        const modId = generateNodeId(this.filePath, 'module', targetClass.name, targetClass.line);
        const modMeta: Record<string, unknown> = { framework: 'angular', decorator: 'NgModule' };

        for (const field of ['declarations', 'imports', 'exports', 'providers', 'bootstrap'] as const) {
          const parsed = extractArrayIdentifiers(args, field);
          if (parsed.identifiers.length > 0) {
            modMeta[field] = parsed.identifiers;
          }
          for (const sym of parsed.identifiers) {
            this.addRef(modId, sym, 'references', dec.line, `ngModule_${field}`);
          }
          if (parsed.hasDynamic) {
            this.addRef(modId, `${targetClass.name}.${field}`, 'references', dec.line, `unresolved:dynamic_ngModule_${field}`);
          }
        }

        this.nodes.push({
          id: modId,
          kind: 'module',
          name: targetClass.name,
          qualifiedName: `${this.filePath}::${targetClass.name}`,
          filePath: this.filePath,
          language: 'typescript',
          startLine: targetClass.line,
          endLine: targetClass.line,
          startColumn: 0,
          endColumn: 0,
          isExported: true,
          decorators: ['@NgModule'],
          docstring: JSON.stringify(modMeta),
          updatedAt: Date.now(),
        });
      } else {
        const clsId = generateNodeId(this.filePath, 'class', targetClass.name, targetClass.line);
        const decTags = [`@${dec.name}`];
        const clsMeta: Record<string, unknown> = { framework: 'angular', decorator: dec.name };

        if (dec.name === 'Directive') {
          const selector = extractStringProp(args, 'selector');
          if (selector.value) {
            decTags.push(`selector:${selector.value}`);
            clsMeta.selector = selector.value;
          }
        } else if (dec.name === 'Pipe') {
          const pipeName = extractStringProp(args, 'name');
          if (pipeName.value) {
            decTags.push(`pipe:${pipeName.value}`);
            clsMeta.pipeName = pipeName.value;
          }
        } else if (dec.name === 'Injectable') {
          const providedIn = extractStringProp(args, 'providedIn');
          if (providedIn.value) {
            decTags.push(`providedIn:${providedIn.value}`);
            clsMeta.providedIn = providedIn.value;
          }
        }
        const standalone = extractBooleanProp(args, 'standalone');
        if (standalone !== undefined) clsMeta.standalone = standalone;

        this.nodes.push({
          id: clsId,
          kind: 'class',
          name: targetClass.name,
          qualifiedName: `${this.filePath}::${targetClass.name}`,
          filePath: this.filePath,
          language: 'typescript',
          startLine: targetClass.line,
          endLine: targetClass.line,
          startColumn: 0,
          endColumn: 0,
          isExported: true,
          decorators: decTags,
          docstring: JSON.stringify(clsMeta),
          updatedAt: Date.now(),
        });
      }
    }
  }

  private extractInputOutputDecorators(cleaned: string): void {
    const propDecorators = scanDecorators(cleaned, ['Input', 'Output']);
    for (const dec of propDecorators) {
      const tail = cleaned.slice(dec.end, dec.end + 160);
      const propMatch = tail.match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[?!:=]/);
      if (!propMatch) continue;
      const propName = propMatch[1]!;
      this.nodes.push({
        id: generateNodeId(this.filePath, 'property', `${dec.name}:${propName}`, dec.line),
        kind: 'property',
        name: propName,
        qualifiedName: `${this.filePath}::${propName}`,
        filePath: this.filePath,
        language: 'typescript',
        startLine: dec.line,
        endLine: dec.line,
        startColumn: 0,
        endColumn: 0,
        isExported: false,
        decorators: [`@${dec.name}`],
        updatedAt: Date.now(),
      });
    }
  }

  private extractDependencyInjection(cleaned: string): void {
    const ctorRe = /\bconstructor\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = ctorRe.exec(cleaned)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const balanced = parseBalanced(cleaned, openIdx, '(', ')');
      if (!balanced) continue;
      const line = lineNumberAt(cleaned, m.index);
      const paramTypeRe = /:\s*([A-Z][A-Za-z0-9_$]*)/g;
      let tm: RegExpExecArray | null;
      while ((tm = paramTypeRe.exec(balanced.body)) !== null) {
        this.addRef(this.fileNodeId, tm[1]!, 'type_of', line, 'di_constructor');
      }
    }

    const injectRe = /\binject\s*\(\s*([A-Z][A-Za-z0-9_$]*)\s*(?:,|\))/g;
    while ((m = injectRe.exec(cleaned)) !== null) {
      const line = lineNumberAt(cleaned, m.index);
      this.addRef(this.fileNodeId, m[1]!, 'references', line, 'di_inject_fn');
    }
  }

  private extractAngularRoutes(cleaned: string): void {
    const routeBlockRe = /(?:Routes\s*=\s*|RouterModule\.for(?:Root|Child)\s*\(\s*|provideRouter\s*\(\s*)\[/g;
    let m: RegExpExecArray | null;
    while ((m = routeBlockRe.exec(cleaned)) !== null) {
      const openBracket = m.index + m[0].length - 1;
      const balanced = parseBalanced(cleaned, openBracket, '[', ']');
      if (!balanced) continue;

      const blockLine = lineNumberAt(cleaned, m.index);
      const objRe = /\{/g;
      let om: RegExpExecArray | null;
      while ((om = objRe.exec(balanced.body)) !== null) {
        const objBalanced = parseBalanced(balanced.body, om.index, '{', '}');
        if (!objBalanced) break;
        const objText = objBalanced.body;
        const routePath = extractStringProp(objText, 'path');
        if (routePath.value !== undefined) {
          const normalizedPath = routePath.value.startsWith('/')
            ? routePath.value
            : `/${routePath.value}`;
          const routeLine = blockLine + lineNumberAt(balanced.body, om.index) - 1;
          const routeId = generateNodeId(this.filePath, 'route', normalizedPath, routeLine);

          const compMatch = objText.match(/\bcomponent\s*:\s*([A-Z][A-Za-z0-9_$]*)/);
          const loadCompMatch = objText.match(
            /\bloadComponent\s*:[\s\S]*?import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
          );
          const loadChildrenMatch = objText.match(
            /\bloadChildren\s*:[\s\S]*?import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
          );

          this.nodes.push({
            id: routeId,
            kind: 'route',
            name: normalizedPath,
            qualifiedName: `${this.filePath}::route:${normalizedPath}`,
            filePath: this.filePath,
            language: 'typescript',
            startLine: routeLine,
            endLine: routeLine,
            startColumn: 0,
            endColumn: 0,
            isExported: true,
            decorators: ['@Route'],
            docstring: JSON.stringify({
              framework: 'angular',
              routePath: normalizedPath,
              component: compMatch?.[1],
            }),
            updatedAt: Date.now(),
          });

          if (compMatch) {
            this.addRef(routeId, compMatch[1]!, 'navigates', routeLine, 'route_component');
          }
          if (loadCompMatch) {
            this.addRef(routeId, loadCompMatch[1]!, 'imports', routeLine, 'route_loadComponent');
          }
          if (loadChildrenMatch) {
            this.addRef(routeId, loadChildrenMatch[1]!, 'imports', routeLine, 'route_loadChildren');
          }
        }
        objRe.lastIndex = objBalanced.end;
      }
      routeBlockRe.lastIndex = balanced.end;
    }
  }
}
