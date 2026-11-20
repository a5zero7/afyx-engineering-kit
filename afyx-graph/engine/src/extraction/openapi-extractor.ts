/**
 * OpenAPI Schema & Endpoint Intelligence Extractor (AFYX-214).
 *
 * Lightweight, native structural extraction for OpenAPI 2.0 (Swagger) and
 * OpenAPI 3.x specifications in JSON and YAML formats.
 *
 * Extracts:
 * - API document root (module)
 * - Routes / Paths (route)
 * - Operations / HTTP methods (function)
 * - Parameters (parameter)
 * - Schemas / Definitions (type_alias)
 * - Fields / Properties (field)
 * - $ref references and relationships (references edges)
 * - Cycle-safe graph traversal
 *
 * Zero external dependencies.
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference, Language } from '../types';
import { generateNodeId } from './node-id';
import { parseJsonc } from '../runtime/jsonc';
import { parseYamlWithLocations } from './yaml-utils';

export function isOpenApiFile(filePath: string, source?: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const baseName = path.basename(normalized);

  // Direct filename match
  if (
    baseName === 'openapi.json' ||
    baseName === 'openapi.yaml' ||
    baseName === 'openapi.yml' ||
    baseName === 'swagger.json' ||
    baseName === 'swagger.yaml' ||
    baseName === 'swagger.yml' ||
    baseName.startsWith('openapi.') ||
    baseName.startsWith('swagger.')
  ) {
    return true;
  }

  // Directory match
  if (
    normalized.includes('/openapi/') ||
    normalized.includes('/swagger/') ||
    normalized.includes('/api-docs/')
  ) {
    if (normalized.endsWith('.json') || normalized.endsWith('.yaml') || normalized.endsWith('.yml')) {
      return true;
    }
  }

  // Content inspection if source provided
  if (source && source.length > 0) {
    const head = source.slice(0, 1000);
    if (
      /"openapi"\s*:\s*"3\./i.test(head) ||
      /openapi\s*:\s*["']?3\./i.test(head) ||
      /"swagger"\s*:\s*"2\./i.test(head) ||
      /swagger\s*:\s*["']?2\./i.test(head)
    ) {
      return true;
    }
  }

  return false;
}

export class OpenApiExtractor {
  private readonly filePath: string;
  private readonly source: string;
  private readonly language: Language;
  private readonly nodes: Node[] = [];
  private readonly edges: Edge[] = [];
  private readonly unresolvedReferences: UnresolvedReference[] = [];
  private readonly errors: ExtractionError[] = [];
  private readonly lines: string[];
  private readonly schemaNodes = new Map<string, Node>();

  constructor(filePath: string, source: string) {
    this.filePath = filePath.replace(/\\/g, '/');
    this.source = source;
    this.lines = source.split(/\r?\n/);
    this.language = this.filePath.endsWith('.json') ? 'json' : 'yaml';
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
      if (this.filePath.endsWith('.json') || this.source.trim().startsWith('{')) {
        const jsoncVal = parseJsonc(this.source);
        parsedDoc = jsoncVal;
      } else {
        const yamlResult = parseYamlWithLocations(this.source);
        parsedDoc = yamlResult.data;
        if (yamlResult.errors.length > 0) {
          for (const err of yamlResult.errors) {
            this.errors.push({
              message: `YAML warning in OpenAPI: ${err}`,
              filePath: this.filePath,
              severity: 'warning',
              code: 'openapi_yaml_warning',
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
          message: `Failed to parse OpenAPI document: ${err instanceof Error ? err.message : String(err)}`,
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

    const isSwagger2 = typeof parsedDoc.swagger === 'string';
    const isOpenApi3 = typeof parsedDoc.openapi === 'string';

    const apiTitle = parsedDoc.info?.title ? String(parsedDoc.info.title) : path.basename(this.filePath);
    const apiVersion = parsedDoc.info?.version
      ? String(parsedDoc.info.version)
      : isSwagger2
      ? String(parsedDoc.swagger)
      : isOpenApi3
      ? String(parsedDoc.openapi)
      : '1.0.0';

    // 1. Root API Document Node
    const rootNodeId = generateNodeId(this.filePath, 'module', apiTitle, 1);
    const rootNode: Node = {
      id: rootNodeId,
      kind: 'module',
      name: apiTitle,
      qualifiedName: `${this.filePath}#${apiTitle}`,
      filePath: this.filePath,
      language: this.language,
      startLine: 1,
      endLine: Math.max(this.lines.length, 1),
      startColumn: 0,
      endColumn: (this.lines[this.lines.length - 1] || '').length,
      docstring: parsedDoc.info?.description ? String(parsedDoc.info.description) : undefined,
      signature: `API: ${apiTitle} (${apiVersion}) [${isSwagger2 ? 'Swagger 2.0' : 'OpenAPI 3.x'}]`,
      updatedAt: Date.now(),
    };
    this.nodes.push(rootNode);

    // 2. Extract Schemas / Definitions first to establish IDs
    const definitions = isSwagger2
      ? parsedDoc.definitions
      : parsedDoc.components?.schemas;

    if (definitions && typeof definitions === 'object') {
      // First pass: create all schema nodes so references can link to them
      for (const [schemaName, schemaObj] of Object.entries(definitions)) {
        if (!schemaObj || typeof schemaObj !== 'object') continue;
        const schemaLine = this.findKeyLine(schemaName);
        const schemaNodeId = generateNodeId(this.filePath, 'type_alias', schemaName, schemaLine);
        const schemaNode: Node = {
          id: schemaNodeId,
          kind: 'type_alias',
          name: schemaName,
          qualifiedName: `${this.filePath}#schemas/${schemaName}`,
          filePath: this.filePath,
          language: this.language,
          startLine: schemaLine,
          endLine: schemaLine,
          startColumn: 0,
          endColumn: 0,
          docstring: (schemaObj as any).description ? String((schemaObj as any).description) : undefined,
          signature: `type ${schemaName}: ${(schemaObj as any).type || 'object'}`,
          updatedAt: Date.now(),
        };
        this.nodes.push(schemaNode);
        this.schemaNodes.set(schemaName, schemaNode);

        this.edges.push({
          source: rootNodeId,
          target: schemaNodeId,
          kind: 'contains',
          line: schemaLine,
        });
      }

      // Second pass: extract fields, nested objects, and $ref edges
      for (const [schemaName, schemaObj] of Object.entries(definitions)) {
        if (!schemaObj || typeof schemaObj !== 'object') continue;
        const schemaNode = this.schemaNodes.get(schemaName);
        if (schemaNode) {
          this.extractSchemaFieldsAndRefs(schemaNode, schemaObj as any, schemaNode.startLine);
        }
      }
    }

    // 3. Extract Paths / Endpoints & Operations
    const paths = parsedDoc.paths;
    if (paths && typeof paths === 'object') {
      for (const [pathStr, pathItem] of Object.entries(paths)) {
        if (!pathItem || typeof pathItem !== 'object') continue;

        const pathLine = this.findKeyLine(pathStr);
        const routeNodeId = generateNodeId(this.filePath, 'route', pathStr, pathLine);
        const routeNode: Node = {
          id: routeNodeId,
          kind: 'route',
          name: pathStr,
          qualifiedName: `${this.filePath}#${pathStr}`,
          filePath: this.filePath,
          language: this.language,
          startLine: pathLine,
          endLine: pathLine,
          startColumn: 0,
          endColumn: 0,
          docstring: (pathItem as any).summary || (pathItem as any).description,
          signature: `route ${pathStr}`,
          updatedAt: Date.now(),
        };
        this.nodes.push(routeNode);

        this.edges.push({
          source: rootNodeId,
          target: routeNodeId,
          kind: 'contains',
          line: pathLine,
        });

        // HTTP Operations
        const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'];
        for (const method of httpMethods) {
          const operation = (pathItem as any)[method];
          if (!operation || typeof operation !== 'object') continue;

          const opLine = this.findKeyLine(method, pathLine);
          const opName = operation.operationId ? String(operation.operationId) : `${method.toUpperCase()} ${pathStr}`;
          const opNodeId = generateNodeId(this.filePath, 'function', `${method.toUpperCase()}:${pathStr}`, opLine);

          const opNode: Node = {
            id: opNodeId,
            kind: 'function',
            name: opName,
            qualifiedName: `${this.filePath}#${method.toUpperCase()}:${pathStr}`,
            filePath: this.filePath,
            language: this.language,
            startLine: opLine,
            endLine: opLine,
            startColumn: 0,
            endColumn: 0,
            docstring: operation.summary || operation.description,
            signature: `${method.toUpperCase()} ${pathStr}`,
            updatedAt: Date.now(),
          };
          this.nodes.push(opNode);

          this.edges.push({
            source: routeNodeId,
            target: opNodeId,
            kind: 'contains',
            line: opLine,
          });

          // Parameters (Path-level + Operation-level)
          const params = [
            ...((pathItem as any).parameters || []),
            ...(operation.parameters || []),
          ];

          for (const param of params) {
            if (!param || typeof param !== 'object') continue;

            if (param.$ref) {
              this.handleRefEdge(opNodeId, param.$ref, opLine);
              continue;
            }

            const paramName = param.name;
            if (!paramName) continue;

            const paramLine = this.findKeyLine(paramName, opLine);
            const paramNodeId = generateNodeId(this.filePath, 'parameter', `${method}:${pathStr}:${paramName}`, paramLine);
            const paramNode: Node = {
              id: paramNodeId,
              kind: 'parameter',
              name: paramName,
              qualifiedName: `${this.filePath}#${method}:${pathStr}:param:${paramName}`,
              filePath: this.filePath,
              language: this.language,
              startLine: paramLine,
              endLine: paramLine,
              startColumn: 0,
              endColumn: 0,
              docstring: param.description,
              signature: `${param.in || 'param'} ${paramName}: ${param.type || param.schema?.type || 'any'}`,
              updatedAt: Date.now(),
            };
            this.nodes.push(paramNode);

            this.edges.push({
              source: opNodeId,
              target: paramNodeId,
              kind: 'contains',
              line: paramLine,
            });

            if (param.schema?.$ref) {
              this.handleRefEdge(paramNodeId, param.schema.$ref, paramLine);
            }
          }

          // Request Body (OpenAPI 3.x)
          if (operation.requestBody && typeof operation.requestBody === 'object') {
            const reqBody = operation.requestBody;
            if (reqBody.$ref) {
              this.handleRefEdge(opNodeId, reqBody.$ref, opLine);
            } else if (reqBody.content && typeof reqBody.content === 'object') {
              for (const mediaObj of Object.values(reqBody.content)) {
                const schema = (mediaObj as any)?.schema;
                if (schema?.$ref) {
                  this.handleRefEdge(opNodeId, schema.$ref, opLine);
                } else if (schema?.items?.$ref) {
                  this.handleRefEdge(opNodeId, schema.items.$ref, opLine);
                }
              }
            }
          }

          // Responses
          if (operation.responses && typeof operation.responses === 'object') {
            for (const responseObj of Object.values(operation.responses)) {
              if (!responseObj || typeof responseObj !== 'object') continue;
              const resp = responseObj as any;
              if (resp.$ref) {
                this.handleRefEdge(opNodeId, resp.$ref, opLine);
              }

              // Swagger 2.0 schema
              if (resp.schema?.$ref) {
                this.handleRefEdge(opNodeId, resp.schema.$ref, opLine);
              } else if (resp.schema?.items?.$ref) {
                this.handleRefEdge(opNodeId, resp.schema.items.$ref, opLine);
              }

              // OpenAPI 3.x content
              if (resp.content && typeof resp.content === 'object') {
                for (const mediaObj of Object.values(resp.content)) {
                  const schema = (mediaObj as any)?.schema;
                  if (schema?.$ref) {
                    this.handleRefEdge(opNodeId, schema.$ref, opLine);
                  } else if (schema?.items?.$ref) {
                    this.handleRefEdge(opNodeId, schema.items.$ref, opLine);
                  }
                }
              }
            }
          }
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

  private extractSchemaFieldsAndRefs(
    schemaNode: Node,
    schemaObj: any,
    baseLine: number,
    visited = new Set<any>()
  ): void {
    if (!schemaObj || typeof schemaObj !== 'object' || visited.has(schemaObj)) {
      return;
    }
    visited.add(schemaObj);

    // Direct $ref
    if (schemaObj.$ref) {
      this.handleRefEdge(schemaNode.id, schemaObj.$ref, baseLine);
    }

    // allOf, anyOf, oneOf
    for (const combo of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(schemaObj[combo])) {
        for (const item of schemaObj[combo]) {
          if (item?.$ref) {
            this.handleRefEdge(schemaNode.id, item.$ref, baseLine);
          } else if (typeof item === 'object') {
            this.extractSchemaFieldsAndRefs(schemaNode, item, baseLine, visited);
          }
        }
      }
    }

    // Properties
    if (schemaObj.properties && typeof schemaObj.properties === 'object') {
      for (const [propName, propDef] of Object.entries(schemaObj.properties)) {
        if (!propDef || typeof propDef !== 'object') continue;
        const propLine = this.findKeyLine(propName, baseLine);
        const propNodeId = generateNodeId(this.filePath, 'field', `${schemaNode.name}.${propName}`, propLine);
        const propNode: Node = {
          id: propNodeId,
          kind: 'field',
          name: propName,
          qualifiedName: `${this.filePath}#schemas/${schemaNode.name}.${propName}`,
          filePath: this.filePath,
          language: this.language,
          startLine: propLine,
          endLine: propLine,
          startColumn: 0,
          endColumn: 0,
          docstring: (propDef as any).description ? String((propDef as any).description) : undefined,
          signature: `${propName}: ${(propDef as any).type || 'any'}`,
          updatedAt: Date.now(),
        };
        this.nodes.push(propNode);

        this.edges.push({
          source: schemaNode.id,
          target: propNodeId,
          kind: 'contains',
          line: propLine,
        });

        const ref = (propDef as any).$ref || (propDef as any).items?.$ref;
        if (ref) {
          this.handleRefEdge(propNodeId, ref, propLine);
        }
      }
    }

    // Array items
    if (schemaObj.items && typeof schemaObj.items === 'object') {
      if (schemaObj.items.$ref) {
        this.handleRefEdge(schemaNode.id, schemaObj.items.$ref, baseLine);
      } else {
        this.extractSchemaFieldsAndRefs(schemaNode, schemaObj.items, baseLine, visited);
      }
    }
  }

  private handleRefEdge(sourceNodeId: string, refString: string, line: number): void {
    if (typeof refString !== 'string') return;

    // Parse ref string: e.g. "#/components/schemas/User" or "#/definitions/User" or "models.yaml#/User"
    const hashIdx = refString.indexOf('#');
    let targetName = '';

    if (hashIdx >= 0) {
      const fragment = refString.slice(hashIdx + 1);
      const parts = fragment.split('/').filter(Boolean);
      targetName = parts[parts.length - 1] || '';
    } else {
      targetName = refString;
    }

    if (!targetName) return;

    // Target schema node ID if defined in this document
    const existing = this.schemaNodes.get(targetName);
    const targetNodeId = existing ? existing.id : generateNodeId(this.filePath, 'type_alias', targetName, line);

    if (refString.startsWith('#/components/schemas/') || refString.startsWith('#/definitions/')) {
      this.edges.push({
        source: sourceNodeId,
        target: targetNodeId,
        kind: 'references',
        line,
      });
    }

    // Always register unresolved reference for cross-file or comprehensive graph resolution
    this.unresolvedReferences.push({
      fromNodeId: sourceNodeId,
      referenceName: targetName,
      referenceKind: 'references',
      line,
      column: 0,
      filePath: this.filePath,
      language: this.language,
    });
  }
}
