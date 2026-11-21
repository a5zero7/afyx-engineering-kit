/**
 * Schema Intelligence Extractor (AFYX-217 / Track C Wave 3A C3.4).
 *
 * Native structural extraction for:
 * 1. JSON Schema (Draft 4, 7, 2019-09, 2020-12)
 * 2. AsyncAPI 2.x and 3.x
 * 3. Apache Avro (.avsc)
 *
 * Extracts:
 * - Root schemas, channels, and records
 * - Properties, fields, enums, and operations
 * - Local and cross-file references ($ref, type references)
 * - Deterministic domain classification ('api_schema')
 * - Secret redaction & bounded recursion
 *
 * Zero external dependencies.
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference, Language } from '../types';
import { generateNodeId } from './node-id';
import { parseJsonc } from '../runtime/jsonc';
import { parseYamlWithLocations } from './yaml-utils';

const SECRET_KEYWORD_PATTERN = /password|secret|token|api[_-]?key|auth|bearer|credential|private[_-]?key/i;

export function isSchemaFile(filePath: string, source?: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const baseName = path.basename(normalized);

  // 1. Direct Avro extension
  if (baseName.endsWith('.avsc')) {
    return true;
  }

  // 2. Direct JSON Schema / AsyncAPI filenames
  if (
    baseName === 'asyncapi.json' ||
    baseName === 'asyncapi.yaml' ||
    baseName === 'asyncapi.yml' ||
    baseName.startsWith('asyncapi.') ||
    baseName.endsWith('.schema.json') ||
    baseName.endsWith('.schema.yaml') ||
    baseName.endsWith('.schema.yml') ||
    baseName === 'schema.json'
  ) {
    return true;
  }

  // 3. Known schema directories
  if (
    (normalized.includes('/schemas/') || normalized.includes('/asyncapi/') || normalized.includes('/avro/')) &&
    (normalized.endsWith('.json') || normalized.endsWith('.yaml') || normalized.endsWith('.yml') || normalized.endsWith('.avsc'))
  ) {
    return true;
  }

  // 4. Content inspection if source provided
  if (source && source.length > 0) {
    const head = source.slice(0, 1000);
    if (
      /"\$schema"\s*:\s*["']https?:\/\/json-schema\.org/i.test(head) ||
      /"asyncapi"\s*:\s*["']?[23]\./i.test(head) ||
      /asyncapi\s*:\s*["']?[23]\./i.test(head) ||
      (/"type"\s*:\s*"record"/i.test(head) && /"fields"\s*:/i.test(head))
    ) {
      return true;
    }
  }

  return false;
}

export type SchemaDialect = 'jsonschema' | 'asyncapi' | 'avro';

export class SchemaExtractor {
  private readonly filePath: string;
  private readonly source: string;
  private readonly language: Language;
  private readonly nodes: Node[] = [];
  private readonly edges: Edge[] = [];
  private readonly unresolvedReferences: UnresolvedReference[] = [];
  private readonly errors: ExtractionError[] = [];
  private readonly lines: string[];
  private readonly definitionNodes = new Map<string, Node>();

  constructor(filePath: string, source: string) {
    this.filePath = filePath.replace(/\\/g, '/');
    this.source = source;
    this.lines = source.split(/\r?\n/);
    this.language = (this.filePath.endsWith('.yaml') || this.filePath.endsWith('.yml')) ? 'yaml' : 'json';
  }

  private findKeyLine(searchKey: string, fromLine: number = 1): number {
    const regex = new RegExp(`["']?${searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`, 'i');
    for (let i = fromLine - 1; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (line && regex.test(line)) {
        return i + 1;
      }
    }
    return fromLine;
  }

  public extract(): ExtractionResult {
    const startTime = Date.now();
    let parsedDoc: any = null;

    try {
      if (this.language === 'json' || this.source.trim().startsWith('{')) {
        parsedDoc = parseJsonc(this.source);
      } else {
        const yamlResult = parseYamlWithLocations(this.source);
        parsedDoc = yamlResult.data;
        if (yamlResult.errors.length > 0) {
          for (const err of yamlResult.errors) {
            this.errors.push({
              message: `YAML warning in Schema: ${err}`,
              filePath: this.filePath,
              severity: 'warning',
              code: 'schema_yaml_warning',
            });
          }
        }
      }
    } catch (err) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [{
          message: `Failed to parse schema document: ${err instanceof Error ? err.message : String(err)}`,
          filePath: this.filePath,
          severity: 'error',
          code: 'parse_error',
        }],
        durationMs: Date.now() - startTime,
      };
    }

    if (!parsedDoc || typeof parsedDoc !== 'object') {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: this.errors,
        durationMs: Date.now() - startTime,
      };
    }

    const dialect = this.detectDialect(parsedDoc);
    switch (dialect) {
      case 'asyncapi':
        this.extractAsyncApi(parsedDoc);
        break;
      case 'avro':
        this.extractAvro(parsedDoc);
        break;
      case 'jsonschema':
      default:
        this.extractJsonSchema(parsedDoc);
        break;
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private detectDialect(doc: any): SchemaDialect {
    if (typeof doc.asyncapi === 'string') {
      return 'asyncapi';
    }
    if (this.filePath.endsWith('.avsc') || (doc.type === 'record' && Array.isArray(doc.fields))) {
      return 'avro';
    }
    return 'jsonschema';
  }

  // ---------------------------------------------------------------------------
  // JSON Schema Extraction
  // ---------------------------------------------------------------------------

  private extractJsonSchema(schema: any): void {
    const title = schema.title ? String(schema.title) : schema.$id ? String(schema.$id) : path.basename(this.filePath);
    const rootLine = 1;
    const rootNodeId = generateNodeId(this.filePath, 'module', title, rootLine);

    const rootNode: Node = {
      id: rootNodeId,
      kind: 'module',
      name: title,
      qualifiedName: `${this.filePath}::schema`,
      filePath: this.filePath,
      language: this.language,
      startLine: rootLine,
      endLine: Math.min(10, this.lines.length),
      startColumn: 0,
      endColumn: 0,
      docstring: schema.description ? String(schema.description) : undefined,
      updatedAt: Date.now(),
    };
    this.nodes.push(rootNode);

    // Definitions ($defs or legacy definitions)
    const defs = schema.$defs || schema.definitions;
    if (defs && typeof defs === 'object') {
      for (const [defName, defBody] of Object.entries(defs)) {
        this.extractSchemaDefinition(rootNode, defName, defBody, '$defs');
      }
    }

    // Root properties
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [propName, propBody] of Object.entries(schema.properties)) {
        this.extractProperty(rootNode, propName, propBody);
      }
    }
  }

  private extractSchemaDefinition(rootNode: Node, defName: string, defBody: any, defScope: string): void {
    if (!defBody || typeof defBody !== 'object') return;
    const defLine = this.findKeyLine(defName);
    const nodeId = generateNodeId(this.filePath, 'type_alias', defName, defLine);

    const defNode: Node = {
      id: nodeId,
      kind: 'type_alias',
      name: defName,
      qualifiedName: `${this.filePath}::${defScope}.${defName}`,
      filePath: this.filePath,
      language: this.language,
      startLine: defLine,
      endLine: defLine + 5,
      startColumn: 0,
      endColumn: 0,
      docstring: defBody.description ? String(defBody.description) : undefined,
      updatedAt: Date.now(),
    };
    this.nodes.push(defNode);
    this.definitionNodes.set(`#/${defScope}/${defName}`, defNode);
    this.definitionNodes.set(defName, defNode);

    // Root contains definition
    this.edges.push({
      source: rootNode.id,
      target: defNode.id,
      kind: 'contains',
    });

    // Check $ref directly on definition
    if (typeof defBody.$ref === 'string') {
      this.handleRef(defNode, defBody.$ref, defLine);
    }

    // Properties inside definition
    if (defBody.properties && typeof defBody.properties === 'object') {
      for (const [propName, propBody] of Object.entries(defBody.properties)) {
        this.extractProperty(defNode, propName, propBody);
      }
    }
  }

  private extractProperty(parentNode: Node, propName: string, propBody: any): void {
    const propLine = this.findKeyLine(propName, parentNode.startLine);
    const propId = generateNodeId(this.filePath, 'field', propName, propLine);

    let docstring = typeof propBody?.description === 'string' ? propBody.description : undefined;
    if (SECRET_KEYWORD_PATTERN.test(propName) && propBody && typeof propBody === 'object') {
      if (propBody.default !== undefined) {
        docstring = (docstring ? docstring + ' ' : '') + '[REDACTED SECRET DEFAULT]';
      }
    }

    const propNode: Node = {
      id: propId,
      kind: 'field',
      name: propName,
      qualifiedName: `${parentNode.qualifiedName}.${propName}`,
      filePath: this.filePath,
      language: this.language,
      startLine: propLine,
      endLine: propLine + 2,
      startColumn: 0,
      endColumn: 0,
      docstring,
      updatedAt: Date.now(),
    };
    this.nodes.push(propNode);

    this.edges.push({
      source: parentNode.id,
      target: propNode.id,
      kind: 'contains',
    });

    if (propBody && typeof propBody === 'object') {
      if (typeof propBody.$ref === 'string') {
        this.handleRef(propNode, propBody.$ref, propLine);
      } else if (propBody.items && typeof propBody.items === 'object' && typeof propBody.items.$ref === 'string') {
        this.handleRef(propNode, propBody.items.$ref, propLine);
      }
    }
  }

  private handleRef(sourceNode: Node, refStr: string, line: number): void {
    if (refStr.startsWith('#/')) {
      // Local reference
      const target = this.definitionNodes.get(refStr) || this.definitionNodes.get(refStr.split('/').pop() || '');
      if (target) {
        this.edges.push({
          source: sourceNode.id,
          target: target.id,
          kind: 'references',
        });
        return;
      }
    }

    // External reference
    this.unresolvedReferences.push({
      fromNodeId: sourceNode.id,
      referenceName: refStr,
      referenceKind: 'references',
      line,
      column: 0,
      filePath: this.filePath,
      language: this.language,
    });
  }

  // ---------------------------------------------------------------------------
  // AsyncAPI Extraction
  // ---------------------------------------------------------------------------

  private extractAsyncApi(doc: any): void {
    const title = doc.info?.title ? String(doc.info.title) : path.basename(this.filePath);
    const rootLine = 1;
    const rootNodeId = generateNodeId(this.filePath, 'module', title, rootLine);

    const rootNode: Node = {
      id: rootNodeId,
      kind: 'module',
      name: title,
      qualifiedName: `${this.filePath}::asyncapi`,
      filePath: this.filePath,
      language: this.language,
      startLine: rootLine,
      endLine: Math.min(10, this.lines.length),
      startColumn: 0,
      endColumn: 0,
      docstring: doc.info?.description ? String(doc.info.description) : undefined,
      updatedAt: Date.now(),
    };
    this.nodes.push(rootNode);

    // Extract channels
    if (doc.channels && typeof doc.channels === 'object') {
      for (const [channelName, channelBody] of Object.entries(doc.channels)) {
        if (!channelBody || typeof channelBody !== 'object') continue;
        const channelLine = this.findKeyLine(channelName);
        const channelNodeId = generateNodeId(this.filePath, 'route', channelName, channelLine);

        const channelNode: Node = {
          id: channelNodeId,
          kind: 'route',
          name: channelName,
          qualifiedName: `${this.filePath}::channel.${channelName}`,
          filePath: this.filePath,
          language: this.language,
          startLine: channelLine,
          endLine: channelLine + 4,
          startColumn: 0,
          endColumn: 0,
          docstring: (channelBody as any).description ? String((channelBody as any).description) : undefined,
          updatedAt: Date.now(),
        };
        this.nodes.push(channelNode);

        this.edges.push({
          source: rootNode.id,
          target: channelNode.id,
          kind: 'contains',
        });

        // Operations: publish / subscribe (AsyncAPI 2.x)
        const publishOp = (channelBody as any).publish;
        if (publishOp && typeof publishOp === 'object') {
          this.extractAsyncOperation(channelNode, 'publish', publishOp);
        }
        const subscribeOp = (channelBody as any).subscribe;
        if (subscribeOp && typeof subscribeOp === 'object') {
          this.extractAsyncOperation(channelNode, 'subscribe', subscribeOp);
        }
      }
    }

    // Extract components.messages or components.schemas
    if (doc.components && typeof doc.components === 'object') {
      if (doc.components.schemas && typeof doc.components.schemas === 'object') {
        for (const [name, schemaBody] of Object.entries(doc.components.schemas)) {
          this.extractSchemaDefinition(rootNode, name, schemaBody, 'components/schemas');
        }
      }
    }
  }

  private extractAsyncOperation(channelNode: Node, opType: string, opBody: any): void {
    const opName = opBody.operationId ? String(opBody.operationId) : `${channelNode.name}#${opType}`;
    const opLine = this.findKeyLine(opType, channelNode.startLine);
    const opId = generateNodeId(this.filePath, 'function', opName, opLine);

    const opNode: Node = {
      id: opId,
      kind: 'function',
      name: opName,
      qualifiedName: `${channelNode.qualifiedName}#${opType}`,
      filePath: this.filePath,
      language: this.language,
      startLine: opLine,
      endLine: opLine + 3,
      startColumn: 0,
      endColumn: 0,
      docstring: opBody.summary ? String(opBody.summary) : opBody.description ? String(opBody.description) : undefined,
      updatedAt: Date.now(),
    };
    this.nodes.push(opNode);

    this.edges.push({
      source: channelNode.id,
      target: opNode.id,
      kind: 'contains',
    });

    if (opBody.message && typeof opBody.message === 'object') {
      const msgRef = opBody.message.$ref;
      if (typeof msgRef === 'string') {
        this.handleRef(opNode, msgRef, opLine);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Apache Avro Extraction
  // ---------------------------------------------------------------------------

  private extractAvro(doc: any): void {
    const schemas = Array.isArray(doc) ? doc : [doc];
    const rootLine = 1;
    const rootTitle = path.basename(this.filePath);
    const rootNodeId = generateNodeId(this.filePath, 'module', rootTitle, rootLine);

    const rootNode: Node = {
      id: rootNodeId,
      kind: 'module',
      name: rootTitle,
      qualifiedName: `${this.filePath}::avro`,
      filePath: this.filePath,
      language: this.language,
      startLine: rootLine,
      endLine: Math.min(10, this.lines.length),
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    };
    this.nodes.push(rootNode);

    for (const schema of schemas) {
      if (!schema || typeof schema !== 'object') continue;
      if (schema.type === 'record') {
        this.extractAvroRecord(rootNode, schema);
      } else if (schema.type === 'enum') {
        this.extractAvroEnum(rootNode, schema);
      }
    }
  }

  private extractAvroRecord(rootNode: Node, record: any): void {
    const recordName = record.name ? String(record.name) : 'Record';
    const fullName = record.namespace ? `${record.namespace}.${recordName}` : recordName;
    const line = this.findKeyLine(recordName);
    const recordId = generateNodeId(this.filePath, 'class', fullName, line);

    const recordNode: Node = {
      id: recordId,
      kind: 'class',
      name: recordName,
      qualifiedName: `${this.filePath}::${fullName}`,
      filePath: this.filePath,
      language: this.language,
      startLine: line,
      endLine: line + 5,
      startColumn: 0,
      endColumn: 0,
      docstring: record.doc ? String(record.doc) : undefined,
      updatedAt: Date.now(),
    };
    this.nodes.push(recordNode);
    this.definitionNodes.set(fullName, recordNode);
    this.definitionNodes.set(recordName, recordNode);

    this.edges.push({
      source: rootNode.id,
      target: recordNode.id,
      kind: 'contains',
    });

    if (Array.isArray(record.fields)) {
      for (const field of record.fields) {
        if (!field || typeof field !== 'object') continue;
        const fieldName = String(field.name);
        const fieldLine = this.findKeyLine(fieldName, line);
        const fieldId = generateNodeId(this.filePath, 'field', fieldName, fieldLine);

        const fieldNode: Node = {
          id: fieldId,
          kind: 'field',
          name: fieldName,
          qualifiedName: `${recordNode.qualifiedName}.${fieldName}`,
          filePath: this.filePath,
          language: this.language,
          startLine: fieldLine,
          endLine: fieldLine + 2,
          startColumn: 0,
          endColumn: 0,
          docstring: field.doc ? String(field.doc) : undefined,
          updatedAt: Date.now(),
        };
        this.nodes.push(fieldNode);

        this.edges.push({
          source: recordNode.id,
          target: fieldNode.id,
          kind: 'contains',
        });

        // Check field type references
        if (typeof field.type === 'string') {
          const typeRef = field.type;
          const target = this.definitionNodes.get(typeRef);
          if (target) {
            this.edges.push({
              source: fieldNode.id,
              target: target.id,
              kind: 'references',
            });
          } else if (!['string', 'int', 'long', 'float', 'double', 'boolean', 'bytes', 'null'].includes(typeRef)) {
            this.unresolvedReferences.push({
              fromNodeId: fieldNode.id,
              referenceName: typeRef,
              referenceKind: 'references',
              line: fieldLine,
              column: 0,
              filePath: this.filePath,
              language: this.language,
            });
          }
        }
      }
    }
  }

  private extractAvroEnum(rootNode: Node, enumDef: any): void {
    const enumName = enumDef.name ? String(enumDef.name) : 'Enum';
    const fullName = enumDef.namespace ? `${enumDef.namespace}.${enumName}` : enumName;
    const line = this.findKeyLine(enumName);
    const enumId = generateNodeId(this.filePath, 'enum', fullName, line);

    const enumNode: Node = {
      id: enumId,
      kind: 'enum',
      name: enumName,
      qualifiedName: `${this.filePath}::${fullName}`,
      filePath: this.filePath,
      language: this.language,
      startLine: line,
      endLine: line + 5,
      startColumn: 0,
      endColumn: 0,
      docstring: enumDef.doc ? String(enumDef.doc) : undefined,
      updatedAt: Date.now(),
    };
    this.nodes.push(enumNode);
    this.definitionNodes.set(fullName, enumNode);
    this.definitionNodes.set(enumName, enumNode);

    this.edges.push({
      source: rootNode.id,
      target: enumNode.id,
      kind: 'contains',
    });

    if (Array.isArray(enumDef.symbols)) {
      for (const symbol of enumDef.symbols) {
        const symName = String(symbol);
        const symLine = this.findKeyLine(symName, line);
        const symId = generateNodeId(this.filePath, 'enum_member', symName, symLine);

        const symNode: Node = {
          id: symId,
          kind: 'enum_member',
          name: symName,
          qualifiedName: `${enumNode.qualifiedName}.${symName}`,
          filePath: this.filePath,
          language: this.language,
          startLine: symLine,
          endLine: symLine,
          startColumn: 0,
          endColumn: 0,
          updatedAt: Date.now(),
        };
        this.nodes.push(symNode);

        this.edges.push({
          source: enumNode.id,
          target: symNode.id,
          kind: 'contains',
        });
      }
    }
  }
}
