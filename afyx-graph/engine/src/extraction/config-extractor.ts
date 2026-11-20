/**
 * AFYX-native Configuration Intelligence Extractor (AFYX-208).
 *
 * Provides static extraction for configuration file families:
 * - JSON and JSONC (`.json`, `.jsonc`, `*.config.json`)
 * - TOML (`.toml`, e.g. `Cargo.toml`, `pyproject.toml`)
 * - INI / CFG / CONF (`.ini`, `.cfg`, `.conf`)
 * - Java Properties (`.properties`)
 * - Environment files (`.env`, `.env.*`)
 *
 * Secret-Safe Contract:
 * - Detects sensitive keys (passwords, tokens, api keys, connection strings, secrets).
 * - Redacts secret values to "[REDACTED]".
 * - Never includes secret values in node IDs, signatures, error messages, or graph attributes.
 *
 * Dependency Extraction:
 * - Extracts environment variable references (${VAR}, ${VAR:-default}, $VAR).
 * - Models hierarchical sections as namespaces and keys as properties/constants.
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';
import { parseJsonc } from '../runtime/jsonc';

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth|credential|conn(?:ection)?[_-]?str(?:ing)?|database[_-]?url|db[_-]?pass/i;

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)(?::-[^}]*)?\}|\$([A-Z_][A-Z0-9_]*)/g;

export function isConfigFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();

  // Spring config files are extracted by the Spring framework resolver (#383)
  if (/^(application|bootstrap)(-[\w.-]+)?\.(yml|yaml|properties)$/i.test(base)) {
    return false;
  }

  if (base === '.env' || base.startsWith('.env.')) return true;
  if (['.toml', '.ini', '.cfg', '.conf', '.properties', '.jsonc'].includes(ext)) return true;
  if (base.endsWith('.config.json') || base === 'tsconfig.json' || base === 'settings.json') return true;
  return false;
}

export class ConfigExtractor {
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
    const base = path.basename(this.filePath).toLowerCase();
    const ext = path.extname(this.filePath).toLowerCase();

    try {
      const fileNode = this.createFileNode();

      if (base === '.env' || base.startsWith('.env.')) {
        this.extractEnv(fileNode.id);
      } else if (ext === '.properties') {
        this.extractProperties(fileNode.id);
      } else if (ext === '.toml') {
        this.extractToml(fileNode.id);
      } else if (ext === '.ini' || ext === '.cfg' || ext === '.conf') {
        this.extractIni(fileNode.id);
      } else if (ext === '.json' || ext === '.jsonc') {
        this.extractJson(fileNode.id);
      }
    } catch (err) {
      this.errors.push({
        message: `Config extraction error in ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        filePath: this.filePath,
        severity: 'warning',
        code: 'config_parse_error',
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

  private createFileNode(): Node {
    const lines = this.source.split(/\r?\n/);
    const fileName = path.basename(this.filePath);
    const id = generateNodeId(this.filePath, 'file', fileName, 1);

    const fileNode: Node = {
      id,
      kind: 'file',
      name: fileName,
      qualifiedName: this.filePath,
      filePath: this.filePath,
      language: 'properties',
      startLine: 1,
      endLine: Math.max(lines.length, 1),
      startColumn: 0,
      endColumn: (lines[lines.length - 1] || '').length,
      updatedAt: Date.now(),
    };

    this.nodes.push(fileNode);
    return fileNode;
  }

  private redactIfSensitive(key: string, value: string): string {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      return '[REDACTED]';
    }
    return value;
  }

  private findEnvReferences(value: string, fromNodeId: string, line: number): void {
    if (!value || typeof value !== 'string') return;
    let match: RegExpExecArray | null;
    ENV_VAR_PATTERN.lastIndex = 0;
    while ((match = ENV_VAR_PATTERN.exec(value)) !== null) {
      const varName = match[1] || match[2];
      if (varName) {
        this.unresolvedReferences.push({
          fromNodeId,
          referenceName: varName,
          referenceKind: 'references',
          line,
          column: match.index,
        });
      }
    }
  }

  private extractEnv(fileNodeId: string): void {
    const lines = this.source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const lineNum = i + 1;
      if (!line || line.startsWith('#')) continue;

      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) continue;

      const rawKey = line.slice(0, eqIndex).trim();
      let rawVal = line.slice(eqIndex + 1).trim();

      // Strip quotes
      if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
        rawVal = rawVal.slice(1, -1);
      }

      const safeVal = this.redactIfSensitive(rawKey, rawVal);
      const nodeId = generateNodeId(this.filePath, 'property', rawKey, lineNum);

      this.nodes.push({
        id: nodeId,
        kind: 'property',
        name: rawKey,
        qualifiedName: `${this.filePath}#${rawKey}`,
        filePath: this.filePath,
        language: 'properties',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: lines[i]!.length,
        signature: `${rawKey}=${safeVal}`,
        updatedAt: Date.now(),
      });

      this.edges.push({
        source: fileNodeId,
        target: nodeId,
        kind: 'contains',
      });

      this.findEnvReferences(rawVal, nodeId, lineNum);
    }
  }

  private extractProperties(fileNodeId: string): void {
    const lines = this.source.split(/\r?\n/);
    let accumulated = '';
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;

      if (!accumulated) startLine = i + 1;

      if (raw.endsWith('\\') && !raw.endsWith('\\\\')) {
        accumulated += raw.slice(0, -1) + ' ';
        continue;
      } else {
        accumulated += raw;
      }

      const line = accumulated.trim();
      accumulated = '';

      // Find separator (= or : or whitespace)
      let sepIdx = -1;
      for (let c = 0; c < line.length; c++) {
        if ((line[c] === '=' || line[c] === ':') && (c === 0 || line[c - 1] !== '\\')) {
          sepIdx = c;
          break;
        }
      }

      if (sepIdx < 0) continue;

      const key = line.slice(0, sepIdx).trim().replace(/\\([=:\s])/g, '$1');
      let val = line.slice(sepIdx + 1).trim();
      const safeVal = this.redactIfSensitive(key, val);

      const nodeId = generateNodeId(this.filePath, 'property', key, startLine);
      this.nodes.push({
        id: nodeId,
        kind: 'property',
        name: key,
        qualifiedName: `${this.filePath}#${key}`,
        filePath: this.filePath,
        language: 'properties',
        startLine,
        endLine: i + 1,
        startColumn: 0,
        endColumn: raw.length,
        signature: `${key}=${safeVal}`,
        updatedAt: Date.now(),
      });

      this.edges.push({
        source: fileNodeId,
        target: nodeId,
        kind: 'contains',
      });

      this.findEnvReferences(val, nodeId, startLine);
    }
  }

  private extractIni(fileNodeId: string): void {
    const lines = this.source.split(/\r?\n/);
    let currentSectionNodeId = fileNodeId;
    let currentSectionName = '';

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const line = raw.trim();
      const lineNum = i + 1;
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;

      // Section header: [SectionName]
      if (line.startsWith('[') && line.endsWith(']')) {
        currentSectionName = line.slice(1, -1).trim();
        const secId = generateNodeId(this.filePath, 'namespace', currentSectionName, lineNum);
        this.nodes.push({
          id: secId,
          kind: 'namespace',
          name: currentSectionName,
          qualifiedName: `${this.filePath}#[${currentSectionName}]`,
          filePath: this.filePath,
          language: 'properties',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `[${currentSectionName}]`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: secId,
          kind: 'contains',
        });
        currentSectionNodeId = secId;
        continue;
      }

      // Key = Value
      const eqIdx = line.indexOf('=') >= 0 ? line.indexOf('=') : line.indexOf(':');
      if (eqIdx <= 0) continue;

      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      const safeVal = this.redactIfSensitive(key, val);
      const qualName = currentSectionName ? `${currentSectionName}.${key}` : key;

      const nodeId = generateNodeId(this.filePath, 'property', qualName, lineNum);
      this.nodes.push({
        id: nodeId,
        kind: 'property',
        name: key,
        qualifiedName: `${this.filePath}#${qualName}`,
        filePath: this.filePath,
        language: 'properties',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: raw.length,
        signature: `${key}=${safeVal}`,
        updatedAt: Date.now(),
      });

      this.edges.push({
        source: currentSectionNodeId,
        target: nodeId,
        kind: 'contains',
      });

      this.findEnvReferences(val, nodeId, lineNum);
    }
  }

  private extractToml(fileNodeId: string): void {
    const lines = this.source.split(/\r?\n/);
    let currentSectionNodeId = fileNodeId;
    let currentSectionName = '';

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const line = raw.trim();
      const lineNum = i + 1;
      if (!line || line.startsWith('#')) continue;

      // Table [table] or [[array_table]]
      if (line.startsWith('[') && line.endsWith(']')) {
        const isArrayTable = line.startsWith('[[') && line.endsWith(']]');
        currentSectionName = isArrayTable ? line.slice(2, -2).trim() : line.slice(1, -1).trim();
        const secId = generateNodeId(this.filePath, 'namespace', currentSectionName, lineNum);

        this.nodes.push({
          id: secId,
          kind: 'namespace',
          name: currentSectionName,
          qualifiedName: `${this.filePath}#[${currentSectionName}]`,
          filePath: this.filePath,
          language: 'properties',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: line,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: secId,
          kind: 'contains',
        });
        currentSectionNodeId = secId;
        continue;
      }

      // Key = value
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;

      let key = line.slice(0, eqIdx).trim();
      if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
      }

      let val = line.slice(eqIdx + 1).trim();
      // Remove trailing comments in TOML
      if (val.includes('#')) {
        val = val.split('#')[0]!.trim();
      }
      const safeVal = this.redactIfSensitive(key, val);
      const qualName = currentSectionName ? `${currentSectionName}.${key}` : key;

      const nodeId = generateNodeId(this.filePath, 'property', qualName, lineNum);
      this.nodes.push({
        id: nodeId,
        kind: 'property',
        name: key,
        qualifiedName: `${this.filePath}#${qualName}`,
        filePath: this.filePath,
        language: 'properties',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: raw.length,
        signature: `${key} = ${safeVal}`,
        updatedAt: Date.now(),
      });

      this.edges.push({
        source: currentSectionNodeId,
        target: nodeId,
        kind: 'contains',
      });

      this.findEnvReferences(val, nodeId, lineNum);
    }
  }

  private extractJson(fileNodeId: string): void {
    let parsed: any;
    try {
      parsed = parseJsonc(this.source);
    } catch (e) {
      this.errors.push({
        message: `JSON syntax error: ${e instanceof Error ? e.message : String(e)}`,
        filePath: this.filePath,
        severity: 'warning',
        code: 'json_syntax_error',
      });
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    this.walkJsonObject(parsed, '', fileNodeId, 1);
  }

  private walkJsonObject(obj: any, prefix: string, parentNodeId: string, approxLine: number): void {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, val] of Object.entries(obj)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const isSensitive = SENSITIVE_KEY_PATTERN.test(key);

      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        // Namespace / Section object
        const secId = generateNodeId(this.filePath, 'namespace', fullPath, approxLine);
        this.nodes.push({
          id: secId,
          kind: 'namespace',
          name: key,
          qualifiedName: `${this.filePath}#${fullPath}`,
          filePath: this.filePath,
          language: 'json',
          startLine: approxLine,
          endLine: approxLine,
          startColumn: 0,
          endColumn: 0,
          signature: `{ ${key} }`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: parentNodeId,
          target: secId,
          kind: 'contains',
        });
        this.walkJsonObject(val, fullPath, secId, approxLine);
      } else {
        // Leaf property
        const strVal = String(val);
        const safeVal = isSensitive ? '[REDACTED]' : (typeof val === 'string' ? `"${val}"` : strVal);
        const propId = generateNodeId(this.filePath, 'property', fullPath, approxLine);

        this.nodes.push({
          id: propId,
          kind: 'property',
          name: key,
          qualifiedName: `${this.filePath}#${fullPath}`,
          filePath: this.filePath,
          language: 'json',
          startLine: approxLine,
          endLine: approxLine,
          startColumn: 0,
          endColumn: 0,
          signature: `"${key}": ${safeVal}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: parentNodeId,
          target: propId,
          kind: 'contains',
        });

        if (typeof val === 'string') {
          this.findEnvReferences(val, propId, approxLine);
        }
      }
    }
  }
}
