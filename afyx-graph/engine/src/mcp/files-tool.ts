import { clamp } from '../utils';
import { boundToolOutput } from './tool-output';
import { textToolResult, type ToolResult } from './tool-results';

export interface FilesToolFile {
  path: string;
  language: string;
  nodeCount: number;
  indexingLevel?: 'metadata' | 'content' | 'structural';
}

export interface FilesToolSource {
  getFiles(): FilesToolFile[];
}

export interface FilesToolRequest {
  path?: string;
  pattern?: string;
  format?: unknown;
  includeMetadata?: unknown;
  maxDepth?: unknown;
}

interface FilesTreeNode {
  name: string;
  children: Map<string, FilesTreeNode>;
  file?: { language: string; nodeCount: number; indexingLevel?: 'metadata' | 'content' | 'structural' };
}

function indexingLabel(file: FilesToolFile): string {
  return `${file.indexingLevel ?? 'structural'}-indexed`;
}

/** Adapt an already path-validated MCP Files request to the frozen Files facts API. */
export function executeFilesTool(source: FilesToolSource, request: FilesToolRequest): ToolResult {
  const format = request.format || 'tree';
  const includeMetadata = request.includeMetadata !== false;
  const maxDepth = request.maxDepth != null ? clamp(request.maxDepth as number, 1, 20) : undefined;
  const allFiles = source.getFiles();

  if (allFiles.length === 0) {
    return textToolResult('No files indexed. Run `afyx-graph index` first.');
  }

  const normalizedPath = normalizePathFilter(request.path);
  let files = normalizedPath
    ? allFiles.filter((file) =>
        file.path === normalizedPath || file.path.startsWith(normalizedPath + '/'))
    : allFiles;

  if (request.pattern) {
    const matcher = globToRegex(request.pattern);
    files = files.filter((file) => matcher.test(file.path));
  }

  if (files.length === 0) {
    return textToolResult('No files found matching the criteria.');
  }

  let output: string;
  switch (format) {
    case 'flat':
      output = formatFilesFlat(files, includeMetadata);
      break;
    case 'grouped':
      output = formatFilesGrouped(files, includeMetadata);
      break;
    case 'tree':
    default:
      output = formatFilesTree(files, includeMetadata, maxDepth);
      break;
  }

  return textToolResult(boundToolOutput(output));
}

function normalizePathFilter(pathFilter: string | undefined): string {
  return pathFilter
    ? pathFilter
        .replace(/\\/g, '/')
        .replace(/^(?:\.?\/+)+/, '')
        .replace(/^\.$/, '')
        .replace(/\/+$/, '')
    : '';
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(escaped);
}

function formatFilesFlat(files: FilesToolFile[], includeMetadata: boolean): string {
  const lines: string[] = [`**Files (${files.length})**`, ''];

  for (const file of files.sort((left, right) => left.path.localeCompare(right.path))) {
    lines.push(includeMetadata
      ? `- ${file.path} (${file.language}, ${indexingLabel(file)}, ${file.nodeCount} symbols)`
      : `- ${file.path}`);
  }

  return lines.join('\n');
}

function formatFilesGrouped(files: FilesToolFile[], includeMetadata: boolean): string {
  const byLanguage = new Map<string, FilesToolFile[]>();
  for (const file of files) {
    const group = byLanguage.get(file.language) || [];
    group.push(file);
    byLanguage.set(file.language, group);
  }

  const lines: string[] = [`**Files by Language (${files.length} total)**`, ''];
  const groups = [...byLanguage.entries()].sort((left, right) => right[1].length - left[1].length);

  for (const [language, languageFiles] of groups) {
    lines.push(`**${language} (${languageFiles.length})**`);
    for (const file of languageFiles.sort((left, right) => left.path.localeCompare(right.path))) {
      lines.push(includeMetadata
        ? `- ${file.path} (${indexingLabel(file)}, ${file.nodeCount} symbols)`
        : `- ${file.path}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatFilesTree(
  files: FilesToolFile[],
  includeMetadata: boolean,
  maxDepth?: number,
): string {
  const root: FilesTreeNode = { name: '', children: new Map() };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part) continue;
      if (!current.children.has(part)) {
        current.children.set(part, { name: part, children: new Map() });
      }
      current = current.children.get(part)!;
      if (index === parts.length - 1) {
        current.file = { language: file.language, nodeCount: file.nodeCount, indexingLevel: file.indexingLevel };
      }
    }
  }

  const lines: string[] = [`**Project Structure (${files.length} files)**`, ''];

  const renderNode = (
    node: FilesTreeNode,
    prefix: string,
    isLast: boolean,
    depth: number,
  ): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;

    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';
    if (node.name) {
      let line = prefix + connector + node.name;
      if (node.file && includeMetadata) {
        line += ` (${node.file.language}, ${node.file.indexingLevel ?? 'structural'}-indexed, ${node.file.nodeCount} symbols)`;
      }
      lines.push(line);
    }

    const children = [...node.children.values()];
    children.sort((left, right) => {
      const leftIsDirectory = left.children.size > 0 && !left.file;
      const rightIsDirectory = right.children.size > 0 && !right.file;
      if (leftIsDirectory !== rightIsDirectory) return leftIsDirectory ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      const nextPrefix = node.name ? prefix + childPrefix : prefix;
      renderNode(child, nextPrefix, index === children.length - 1, depth + 1);
    }
  };

  renderNode(root, '', true, 0);
  return lines.join('\n');
}
