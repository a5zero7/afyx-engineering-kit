import { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';
import { extractNativeFacts } from './native/fact-extractor';
import { findRazorCodeRegions } from './razor-regions';

/**
 * RazorExtractor — extracts code relationships from ASP.NET Razor (`.cshtml`)
 * and Blazor (`.razor`) markup.
 *
 * Markup-driven code-behind, view-models, components, and DTOs are referenced
 * only from markup the engine otherwise doesn't parse, so they look like nothing
 * depends on them. This extractor links the markup → the C# types it names:
 *
 *  - `@model Foo` / `@inherits Bar<Foo>`  → the view-model / base type (.cshtml + .razor)
 *  - `@inject IService svc`               → the injected service type
 *  - `@typeof(MainLayout)`                → the referenced type
 *  - `<MyComponent .../>` (Blazor only)   → the component class (.razor or `.cs : ComponentBase`)
 *  - `<Grid TItem="CatalogItem">`         → the generic type argument
 *
 * Risk mitigations (see docs/design/template-markup-parser.md):
 *  - Only PascalCase (`[A-Z]`-initial) tags are treated as components — HTML
 *    elements are lowercase, so they never match. Known Blazor framework
 *    components are skipped (they aren't in-repo, so a ref would just dangle).
 *  - Exactly ONE `component` node per file; component tags become `references`
 *    EDGES, never nodes — no per-tag node explosion.
 *  - Emitted refs are ordinary by-name `references` resolved by the name-matcher;
 *    `razor` shares the `dotnet` language family with `csharp` (name-matcher.ts)
 *    so the cross-family gate doesn't drop them.
 *  - `.cshtml`/`.razor` are registered in grammars.ts so they're indexed.
 *
 * Out of scope (data-flow / low-value): `asp-for`/`th:field` property-string
 * bindings; the C# inside `@code { }` / `@{ }` blocks (noisy regex on embedded C#).
 */

/**
 * Blazor framework-provided components — invoked by the runtime, not defined
 * in-repo, so a reference to them would never resolve. Skip to avoid dangling refs.
 */
const BLAZOR_BUILTIN_COMPONENTS = new Set([
  'Router', 'Found', 'NotFound', 'RouteView', 'AuthorizeRouteView', 'LayoutView',
  'CascadingValue', 'CascadingAuthenticationState', 'AuthorizeView', 'Authorized',
  'NotAuthorized', 'Authorizing', 'EditForm', 'DataAnnotationsValidator',
  'ValidationSummary', 'ValidationMessage', 'InputText', 'InputNumber',
  'InputCheckbox', 'InputSelect', 'InputDate', 'InputTextArea', 'InputRadio',
  'InputRadioGroup', 'InputFile', 'PageTitle', 'HeadContent', 'HeadOutlet',
  'Virtualize', 'DynamicComponent', 'ErrorBoundary', 'SectionContent',
  'SectionOutlet', 'FocusOnNavigate', 'NavLink', 'Microsoft',
]);

export class RazorExtractor {
  private filePath: string;
  private source: string;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private unresolvedReferences: UnresolvedReference[] = [];
  private errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    try {
      const componentId = this.createComponentNode().id;
      this.extractDirectives(componentId);
      // Blazor component tags only — `.cshtml` uses HTML + tag helpers, not
      // PascalCase component elements.
      if (this.filePath.toLowerCase().endsWith('.razor')) {
        this.extractComponentTags(componentId);
      }
      // Delegate the C# in `@code { }` / `@functions { }` / `@{ }` blocks to the
      // C# tree-sitter extractor (the Blazor analog of Svelte's <script> block) —
      // this is where component logic uses services/DTOs, so it covers the types
      // referenced only from component code.
      this.processCodeBlocks(componentId);
    } catch (error) {
      this.errors.push({
        message: `Razor extraction error: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
        code: 'parse_error',
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

  private createComponentNode(): Node {
    const lines = this.source.split('\n');
    const fileName = this.filePath.split(/[/\\]/).pop() || this.filePath;
    const componentName = fileName.replace(/\.(razor|cshtml)$/i, '');
    const node: Node = {
      id: generateNodeId(this.filePath, 'component', componentName, 1),
      kind: 'component',
      name: componentName,
      qualifiedName: `${this.filePath}::${componentName}`,
      filePath: this.filePath,
      language: 'razor',
      startLine: 1,
      endLine: lines.length,
      startColumn: 0,
      endColumn: lines[lines.length - 1]?.length || 0,
      isExported: true,
      updatedAt: Date.now(),
    };
    this.nodes.push(node);
    return node;
  }

  /** Last `.`-segment (`App.ViewModels.RegisterModel` → `RegisterModel`). */
  private lastSegment(s: string): string {
    const i = s.lastIndexOf('.');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  /**
   * Split a type expression into the capitalized type names it contains — base
   * type plus any generic arguments (`Bar<Foo, Baz>` → `Bar`, `Foo`, `Baz`),
   * each reduced to its last namespace segment. Lowercase/keyword tokens drop out.
   */
  private typeNames(expr: string): string[] {
    const out: string[] = [];
    for (const raw of expr.split(/[<>,\s]+/)) {
      const seg = this.lastSegment(raw.trim());
      if (/^[A-Z][A-Za-z0-9_]*$/.test(seg)) out.push(seg);
    }
    return out;
  }

  private pushRef(componentId: string, name: string, line: number, column: number): void {
    this.unresolvedReferences.push({
      fromNodeId: componentId,
      referenceName: name,
      referenceKind: 'references',
      line,
      column,
      filePath: this.filePath,
      language: 'razor',
    });
  }

  private extractDirectives(componentId: string): void {
    const lines = this.source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // `@model Foo` / `@inherits Bar<Foo>` — directive followed by a type.
      const dir = line.match(/^\s*@(?:model|inherits)\s+([A-Za-z_][\w.]*(?:\s*<[^>]+>)?)/);
      if (dir) for (const t of this.typeNames(dir[1]!)) this.pushRef(componentId, t, i + 1, 0);
      // `@inject IService name` — the type is the first token, a name follows.
      const inj = line.match(/^\s*@inject\s+([A-Za-z_][\w.]*(?:\s*<[^>]+>)?)\s+[A-Za-z_]/);
      if (inj) for (const t of this.typeNames(inj[1]!)) this.pushRef(componentId, t, i + 1, 0);
      // `@typeof(X)` anywhere on the line.
      for (const m of line.matchAll(/@typeof\(\s*([A-Za-z_][\w.]*)\s*\)/g)) {
        const seg = this.lastSegment(m[1]!);
        if (/^[A-Z]/.test(seg)) this.pushRef(componentId, seg, i + 1, m.index ?? 0);
      }
    }
  }

  private extractComponentTags(componentId: string): void {
    const lines = this.source.split('\n');
    // PascalCase opening / self-closing tags. Closing tags (`</Foo>`) start with
    // `</` and are skipped. HTML elements are lowercase → never match.
    const tagRe = /<([A-Z][A-Za-z0-9_]*)\b([^>]*)>/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let m: RegExpExecArray | null;
      while ((m = tagRe.exec(line)) !== null) {
        const name = m[1]!;
        if (BLAZOR_BUILTIN_COMPONENTS.has(name)) continue;
        this.pushRef(componentId, name, i + 1, m.index + 1);
        // Generic component type arg: `<Grid TItem="CatalogItem">`.
        for (const t of (m[2] || '').matchAll(/\bT[A-Za-z]*\s*=\s*"([A-Za-z_][\w.]*)"/g)) {
          const seg = this.lastSegment(t[1]!);
          if (/^[A-Z]/.test(seg)) this.pushRef(componentId, seg, i + 1, 0);
        }
      }
    }
  }

  /**
   * Attribute each supported C# block's external references to the component.
   * Production extracts each local region through the Afyx-native fact seam.
   * Dependency references only are kept; per-member nodes remain outside the
   * established Razor graph contract.
   */
  private processCodeBlocks(componentId: string): void {
    for (const block of findRazorCodeRegions(this.source, true)) {
      if (!block.content.trim()) continue;
      const result = extractNativeFacts(this.filePath, block.content, 'csharp');
      const localLines = block.content.split(/\r?\n/);
      for (const ref of result.unresolvedReferences) {
        const localLine = localLines[ref.line - 1] ?? '';
        const isConstruction = ref.referenceKind === 'calls' &&
          /\bnew\s*$/.test(localLine.slice(0, ref.column));
        this.unresolvedReferences.push({
          ...ref,
          fromNodeId: componentId,
          referenceKind: isConstruction ? 'references' : ref.referenceKind,
          line: ref.line + block.startLine - 1,
          column: ref.column + (ref.line === 1 ? block.startColumn : 0),
          filePath: this.filePath,
          language: 'razor',
        });
      }
    }
  }
}
