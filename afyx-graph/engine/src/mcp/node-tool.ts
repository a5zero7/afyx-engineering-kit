import type AfyxGraph from '../index';
import type { Edge, Node, NodeKind } from '../types';
import { CONFIG_LEAF_LANGUAGES, isConfigLeafNode } from '../utils';
import { lastQualifierPart, matchesSymbol } from '../graph/symbol-lookup';
import { boundToolOutput } from './tool-output';
import { textToolResult, type ToolResult } from './tool-results';

type NodeToolSource = Pick<
  AfyxGraph,
  | 'getFiles'
  | 'getNodesInFile'
  | 'getFileDependents'
  | 'getNodesByName'
  | 'searchNodes'
  | 'generatedFilePredicate'
  | 'getCode'
  | 'getChildren'
  | 'getCallers'
  | 'getCallees'
>;

export interface NodeToolHost {
  validateSymbol(value: unknown): string | ToolResult;
  isFileStale(filePath: string): boolean;
  readCurrentFile(filePath: string): string | null;
  numberSourceLines(source: string, startLine: number): string;
  synthEdgeLabel(edge: Edge): string | null;
  isContainerKind(kind: NodeKind): boolean;
}

const STALE_WHOLE_FILE_MAX_LINES = 300;
const STALE_WHOLE_FILE_MAX_CHARS = 12000;

type NodeRequest = {
  includeCode: boolean;
  fileHint?: string;
  lineHint?: number;
  offset?: number;
  limit?: number;
  symbolsOnly: boolean;
  symbolRaw: string;
};

function readNodeRequest(args: Record<string, unknown>): NodeRequest {
  const positiveInteger = (value: unknown): number | undefined =>
    typeof value === 'number' && value > 0 ? Math.floor(value) : undefined;
  const trimmedFile = typeof args.file === 'string' ? args.file.trim() : '';
  return {
    includeCode: args.includeCode === true,
    fileHint: trimmedFile || undefined,
    lineHint: typeof args.line === 'number' && args.line > 0 ? args.line : undefined,
    offset: positiveInteger(args.offset),
    limit: positiveInteger(args.limit),
    symbolsOnly: args.symbolsOnly === true,
    symbolRaw: typeof args.symbol === 'string' ? args.symbol.trim() : '',
  };
}

function narrowDefinitions(definitions: Node[], fileHint?: string, lineHint?: number): Node[] {
  let selected = definitions;
  if (fileHint) {
    const wanted = fileHint.replace(/\\/g, '/').toLowerCase();
    const inFile = selected.filter(({ filePath }) => {
      const normalized = filePath.replace(/\\/g, '/').toLowerCase();
      return normalized.endsWith(wanted) || normalized.includes(wanted);
    });
    if (inFile.length) selected = inFile;
  }
  if (lineHint !== undefined && selected.length > 1) {
    const spanning = selected.filter(({ startLine, endLine }) =>
      startLine <= lineHint && (endLine ?? startLine) >= lineHint);
    if (spanning.length) return spanning;
    const nearest = selected.reduce((current, candidate) =>
      Math.abs(candidate.startLine - lineHint) < Math.abs(current.startLine - lineHint)
        ? candidate
        : current,
    selected[0]!);
    return [nearest];
  }
  return selected;
}

async function packDefinitionBodies(
  source: NodeToolSource,
  definitions: Node[],
  host: NodeToolHost,
): Promise<{ full: string[]; remaining: Node[] }> {
  const full: string[] = [];
  const remaining: Node[] = [];
  let characters = 0;
  for (const definition of definitions) {
    if (full.length === 16) {
      remaining.push(definition);
      continue;
    }
    const body = await renderNodeSection(source, definition, true, host);
    const fits = full.length === 0 || characters + body.length <= 12000;
    if (fits) {
      full.push(body);
      characters += body.length;
    } else {
      remaining.push(definition);
    }
  }
  return { full, remaining };
}

export async function executeNodeTool(
  source: NodeToolSource,
  args: Record<string, unknown>,
  host: NodeToolHost,
): Promise<ToolResult> {
  const request = readNodeRequest(args);
  if (!request.symbolRaw && request.fileHint) {
    return executeFileView(source, request.fileHint, request, host);
  }

  const symbol = host.validateSymbol(args.symbol);
  if (typeof symbol !== 'string') return symbol;

  let definitions = resolveNodeSymbolMatches(source, symbol);
  if (!definitions.length) return textToolResult(`Symbol "${symbol}" not found in the codebase`);
  if (definitions.length > 1 && (request.fileHint || request.lineHint !== undefined)) {
    definitions = narrowDefinitions(definitions, request.fileHint, request.lineHint);
  }
  if (definitions.length === 1) {
    const rendered = await renderNodeSection(source, definitions[0]!, request.includeCode, host);
    return textToolResult(boundToolOutput(rendered));
  }

  const header = `**${definitions.length} definitions named "${symbol}"**`;
  if (!request.includeCode) {
    const locations = definitions.map(
      ({ name, kind, filePath, startLine }) => `- \`${name}\` (${kind}) — ${filePath}:${startLine}`,
    );
    const guidance = 'Re-query with `includeCode: true` to get every body in one call — no need to pick one first.';
    return textToolResult(boundToolOutput([header, '', guidance, '', ...locations].join('\n')));
  }

  const { full, remaining } = await packDefinitionBodies(source, definitions, host);
  const output = [
    header,
    `Returning ${full.length} in full${remaining.length ? `; ${remaining.length} more listed below` : ''} — pick the one you need (no Read required).`,
    '',
    full.join('\n\n---\n\n'),
  ];
  if (remaining.length) {
    output.push('', '**Other definitions**');
    output.push(...remaining.slice(0, 20).map(
      ({ name, kind, filePath, startLine }) => `- \`${name}\` (${kind}) — ${filePath}:${startLine}`,
    ));
    if (remaining.length > 20) output.push(`- … +${remaining.length - 20} more`);
    output.push(
      '',
      `> Need one of these in full? Call afyx_graph_node again with \`file\` (e.g. \`"${remaining[0]!.filePath.split('/').pop()}"\`) or \`line\` — do NOT Read it.`,
    );
  }
  return textToolResult(boundToolOutput(output.join('\n')));
}
type IndexedFile = ReturnType<NodeToolSource['getFiles']>[number];

function resolveFileSelection(
  files: IndexedFile[],
  request: string,
): { file?: IndexedFile; alternatives: IndexedFile[] } {
  const wanted = request
    .replace(/\\/g, '/')
    .replace(/^(?:\.?\/+)+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  const exact = files.find(({ path }) => path.toLowerCase() === wanted);
  if (exact) return { file: exact, alternatives: [] };

  const suffixes = files.filter(({ path }) => path.toLowerCase().endsWith('/' + wanted));
  if (suffixes.length === 1) return { file: suffixes[0], alternatives: suffixes };
  if (suffixes.length > 1) return { alternatives: suffixes };

  const fragments = files.filter(({ path }) => path.toLowerCase().includes(wanted));
  return {
    file: fragments.length === 1 ? fragments[0] : undefined,
    alternatives: fragments,
  };
}

async function executeFileView(
  source: NodeToolSource,
  fileArg: string,
  opts: { offset?: number; limit?: number; symbolsOnly?: boolean },
  host: NodeToolHost,
): Promise<ToolResult> {
    const allFiles = source.getFiles();
  if (!allFiles.length) return textToolResult('No files indexed. Run `afyx-graph index` first.');

  const selection = resolveFileSelection(allFiles, fileArg);
  if (selection.alternatives.length > 1) {
    const choices = selection.alternatives.slice(0, 25).map(({ path }) => `- ${path}`);
    return textToolResult([
      `"${fileArg}" matches ${selection.alternatives.length} indexed files — pass a longer path:`,
      '',
      ...choices,
    ].join('\n'));
  }
  if (!selection.file) {
      return textToolResult(
        `No indexed file matches "${fileArg}". Afyx Graph indexes source files; configs/docs it doesn't parse won't appear — Read those directly.`,
      );
    }
  const resolved = selection.file;

    const filePath = resolved.path;
    const nodes = source.getNodesInFile(filePath)
      .filter((n) => n.kind !== 'file' && n.kind !== 'import' && n.kind !== 'export')
      .sort((a, b) => a.startLine - b.startLine);
    const dependents = source.getFileDependents(filePath);

    const depSummary = dependents.length
      ? `used by ${dependents.length} file${dependents.length === 1 ? '' : 's'}: ${dependents.slice(0, 8).join(', ')}${dependents.length > 8 ? `, +${dependents.length - 8} more` : ''}`
      : 'no other indexed file depends on it';

  const symbolMap = (heading: string, limit = 200): string[] => {
    const entries = nodes.slice(0, limit).map((node) => {
      const signature = node.signature ? ` ${node.signature.replace(/\s+/g, ' ').trim()}` : '';
      return `- \`${node.name}\` (${node.kind})${signature} — :${node.startLine}`;
    });
    const overflow = nodes.length > limit ? [`- … +${nodes.length - limit} more`] : [];
    return [heading, ...entries, ...overflow];
  };

    if (opts.symbolsOnly) {
      const out = [`**${filePath}** — ${nodes.length} symbol${nodes.length === 1 ? '' : 's'}, ${depSummary}`, ''];
      if (nodes.length) out.push(...symbolMap('**Symbols**'));
      else out.push('_No indexed symbols in this file._');
      out.push('', '> Drop `symbolsOnly` (or pass `offset`/`limit`) to read the source, like Read.');
      return textToolResult(boundToolOutput(out.join('\n')));
    }

    if (CONFIG_LEAF_LANGUAGES.has(resolved.language)) {
      const out = [`**${filePath}** — configuration/data file, ${depSummary}`, ''];
      if (nodes.length) out.push(...symbolMap('**Keys (values withheld for safety)**'));
      out.push('', '> Values may be secrets, so afyx-graph indexes keys only. Read the file directly if you need a value.');
      return textToolResult(boundToolOutput(out.join('\n')));
    }

    const content = host.readCurrentFile(filePath);
 if (content === null) {
      const out = [`**${filePath}** — could not read from disk (it may have moved since indexing). ${depSummary}`, ''];
      if (nodes.length) out.push(...symbolMap('**Symbols**'));
      out.push('', `> Read \`${filePath}\` directly for its current content.`);
      return textToolResult(boundToolOutput(out.join('\n')));
    }

    const fileLines = content.split('\n');
    const total = fileLines.length;

    const CHAR_BUDGET = 38000;
    const DEFAULT_LIMIT = 2000;
    const offset = Math.max(1, opts.offset ?? 1);
    if (offset > total) {
      return textToolResult(`**${filePath}** has ${total} line${total === 1 ? '' : 's'} — offset ${offset} is past the end. ${depSummary}`);
    }
    const maxLines = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
    const start = offset - 1; // 0-based
    const header = `**${filePath}** — ${total} lines, ${nodes.length} symbol${nodes.length === 1 ? '' : 's'} · ${depSummary}`;

  const numbered: string[] = [];
  let used = header.length + 8;
  const available = fileLines.slice(start, start + maxLines);
  available.some((content, relativeIndex) => {
    const line = `${start + relativeIndex + 1}\t${content}`;
    const overBudget = used + line.length + 1 > CHAR_BUDGET && numbered.length > 0;
    if (overBudget) return true;
    numbered.push(line);
    used += line.length + 1;
    return false;
  });
    const shownEnd = start + numbered.length;
    const complete = offset === 1 && shownEnd >= total;

    const out: string[] = [header, '', ...numbered];
    if (!complete) {
      out.push(
        '',
        `(lines ${offset}–${shownEnd} of ${total} — pass \`offset\`/\`limit\` for another range, or \`afyx_graph_node <symbol>\` for one symbol in full)`,
      );
    }
    return textToolResult(out.join('\n'));
  }


async function renderNodeSection(
  source: NodeToolSource,
  node: Node,
  includeCode: boolean,
  host: NodeToolHost,
): Promise<string> {
    if (host.isFileStale(node.filePath)) {
      return renderStaleNodeSection(source, node, includeCode, host);
    }
    let code: string | null = null;
    let outline: string | null = null;
    if (includeCode) {
      if (host.isContainerKind(node.kind)) {
        outline = buildContainerOutline(source, node);
      }
      if (!outline) {
        code = await source.getCode(node.id);
      }
    }
    return formatNodeDetails(node, code, outline, host) + formatTrail(source, node, host);
  }


function renderStaleNodeSection(
  source: NodeToolSource,
  node: Node,
  includeCode: boolean,
  host: NodeToolHost,
): string {
    const lines: string[] = [
      `**${node.name}** (${node.kind})`,
      '',
      `**Location:** ${node.filePath}${node.startLine ? `:${node.startLine}` : ''} — ⚠ as of the last index sync; the file has changed on disk since, so this line may be shifted`,
    ];
    if (node.signature) {
      lines.push(`**Signature:** \`${node.signature}\``);
    }
    lines.push('');
    let embedded = false;
    if (includeCode) {
      try {
        const content = host.readCurrentFile(node.filePath);
 if (content !== null && !isConfigLeafNode(node)) {
 const body = content.replace(/\n+$/, '');
          if (
            body.length <= STALE_WHOLE_FILE_MAX_CHARS &&
            body.split('\n').length <= STALE_WHOLE_FILE_MAX_LINES
          ) {
            lines.push(
              `> ⚠ \`${node.filePath}\` changed on disk after it was last indexed, so the indexed line range for this symbol may no longer match. Showing the file's full CURRENT source instead (Read-parity — treat it as already Read):`,
              '',
              '```' + (node.language || ''),
              host.numberSourceLines(body, 1),
              '```',
            );
            embedded = true;
          }
        }
      } catch {
        /* fall through to the notice */
      }
    }
    if (!embedded) {
      lines.push(
        `> ⚠ \`${node.filePath}\` changed on disk after it was last indexed — the indexed line range for this symbol no longer reliably matches, so its body is omitted rather than risk showing a different symbol's code. For current content, call afyx_graph_node with \`file: "${node.filePath}"\` (no symbol; \`offset\`/\`limit\` narrow it like Read), or Read the file. The change is picked up automatically on that project's next index sync.`,
      );
    }
    return lines.join('\n') + formatTrail(source, node, host);
  }


function formatTrail(source: NodeToolSource, node: Node, host: NodeToolHost): string {
    const TRAIL_CAP = 12;
    const fmt = (e: { node: Node; edge: Edge }) => {
      const base = `${e.node.name} (${e.node.filePath}:${e.node.startLine})`;
      const synth = host.synthEdgeLabel(e.edge);
      return synth ? `${base} [${synth}]` : base;
    };
  const distinct = (relations: Array<{ node: Node; edge: Edge }>) => {
    const visited = new Set([node.id]);
    return relations.filter(({ node: related }) => {
      if (visited.has(related.id)) return false;
      visited.add(related.id);
      return true;
    });
  };
  const callees = distinct(source.getCallees(node.id));
  const callers = distinct(source.getCallers(node.id));
    if (callees.length === 0 && callers.length === 0) return '';
    const lines: string[] = ['', '**Trail — afyx_graph_node any of these to follow it (no Read needed)**'];
    if (callees.length > 0) {
      lines.push(`**Calls →** ${callees.slice(0, TRAIL_CAP).map(fmt).join(', ')}${callees.length > TRAIL_CAP ? `, +${callees.length - TRAIL_CAP} more` : ''}`);
    }
    if (callers.length > 0) {
      lines.push(`**Called by ←** ${callers.slice(0, TRAIL_CAP).map(fmt).join(', ')}${callers.length > TRAIL_CAP ? `, +${callers.length - TRAIL_CAP} more` : ''}`);
    }
    return lines.join('\n');
  }


export function resolveNodeSymbolMatches(source: NodeToolSource, symbol: string): Node[] {
  const isQualified = /[.\/]|::/.test(symbol);

  if (!isQualified) {
    const exact = source.getNodesByName(symbol);
    if (exact.length > 0) {
      const isGen = source.generatedFilePredicate(exact.map((n) => n.filePath));
      return [...exact].sort((a, b) => (isGen(a.filePath) ? 1 : 0) - (isGen(b.filePath) ? 1 : 0));
    }
    const fuzzy = source.searchNodes(symbol, { limit: 10 });
    return fuzzy[0] ? [fuzzy[0].node] : [];
  }

  const limit = 50;
  let results = source.searchNodes(symbol, { limit });

  if (isQualified && results.length === 0) {
    const tail = lastQualifierPart(symbol);
    if (tail && tail !== symbol) results = source.searchNodes(tail, { limit });
  }

  if (results.length === 0) return [];

  const exactMatches = results.filter((r) => matchesSymbol(r.node, symbol));
  if (exactMatches.length === 0) {
    return isQualified ? [] : results[0] ? [results[0].node] : [];
  }

  const isGen = source.generatedFilePredicate(exactMatches.map((r) => r.node.filePath));
  return [...exactMatches]
    .sort((a, b) => (isGen(a.node.filePath) ? 1 : 0) - (isGen(b.node.filePath) ? 1 : 0))
    .map((r) => r.node);
}


function buildContainerOutline(source: NodeToolSource, node: Node): string {
  const members = source.getChildren(node.id)
    .filter(({ kind }) => kind !== 'import' && kind !== 'export')
    .sort((left, right) => (left.startLine ?? 0) - (right.startLine ?? 0));
  if (!members.length) return '';
  const rows = members.map((member) => {
    const line = member.startLine ? `:${member.startLine}` : '';
    const signature = member.signature ? ` — \`${member.signature}\`` : '';
    return `- ${member.name} (${member.kind})${line}${signature}`;
  });
  return [`**Members (${members.length}):**`, '', ...rows].join('\n');
}

function formatNodeDetails(node: Node, code: string | null, outline: string | null | undefined, host: NodeToolHost): string {
  const suffix = node.startLine ? `:${node.startLine}` : '';
  const lines = [`**${node.name}** (${node.kind})`, '', `**Location:** ${node.filePath}${suffix}`];
  if (node.signature) lines.push(`**Signature:** \`${node.signature}\``);
  const shortDocumentation = node.docstring && node.docstring.length < 200 ? node.docstring : null;
  if (shortDocumentation) lines.push('', shortDocumentation);

  if (outline) {
    lines.push('', outline, '',
      `> Structural outline only. Read \`${node.filePath}\` or call afyx_graph_node on a specific member for its body.`);
  } else if (code) {
    const numbered = node.startLine ? host.numberSourceLines(code, node.startLine) : code;
    lines.push('', '```' + node.language, numbered, '```');
  }

  return lines.join('\n');
}

