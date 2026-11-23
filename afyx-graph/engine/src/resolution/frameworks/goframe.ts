/**
 * AFYX Engineering Kit - GoFrame Framework Resolver
 *
 * Implements route node extraction for GoFrame applications by inspecting struct tags:
 * 1. Reads `g.Meta` embedded struct tags on request structs (`path:"/...", method:"..."`)
 * 2. Emits corresponding HTTP route nodes (`GET /path`, `POST /path`)
 * 3. Associates request types through `GOFRAME_ROUTE_MARKER` in `qualifiedName` for whole-graph reflective joins.
 */

import type { Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { stripCommentsForRegex } from '../strip-comments';

const GOFRAME_STRUCT_META_PATTERN = /\btype\s+([A-Z]\w*)\s+struct\s*\{\s*g\.Meta\s+`([^`]*)`/g;
const STRUCT_TAG_PATH_PATTERN = /\bpath:"([^"]+)"/;
const STRUCT_TAG_METHOD_PATTERN = /\bmethod:"([^"]+)"/;
const GO_PACKAGE_NAME_PATTERN = /^\s*package\s+(\w+)/m;

export const GOFRAME_ROUTE_MARKER = '::goframe-route:';

export const goframeResolver: FrameworkResolver = {
  name: 'goframe',
  languages: ['go'],

  detect(context: ResolutionContext): boolean {
    const modContent = context.readFile('go.mod');
    return !!modContent && modContent.includes('github.com/gogf/gf');
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.go') || !content.includes('g.Meta')) {
      return { nodes: [], references: [] };
    }

    const createdNodes: Node[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'go');
    const packageName = GO_PACKAGE_NAME_PATTERN.exec(cleanSource)?.[1];

    GOFRAME_STRUCT_META_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = GOFRAME_STRUCT_META_PATTERN.exec(cleanSource)) !== null) {
      const requestTypeName = match[1]!;
      const tagContent = match[2]!;

      const pathMatch = STRUCT_TAG_PATH_PATTERN.exec(tagContent);
      if (!pathMatch) continue;

      const endpointPath = pathMatch[1]!;
      const methodMatch = STRUCT_TAG_METHOD_PATTERN.exec(tagContent);
      const httpVerb = methodMatch ? methodMatch[1]!.toUpperCase() : 'ANY';
      const lineNumber = cleanSource.slice(0, match.index).split('\n').length;
      const joinIdentifier = packageName ? `${packageName}.${requestTypeName}` : requestTypeName;

      createdNodes.push({
        id: `route:${filePath}:${lineNumber}:${httpVerb}:${endpointPath}`,
        kind: 'route',
        name: `${httpVerb} ${endpointPath}`,
        qualifiedName: `${filePath}${GOFRAME_ROUTE_MARKER}${joinIdentifier}`,
        filePath,
        startLine: lineNumber,
        endLine: lineNumber,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'go',
        updatedAt: timestamp,
      });
    }

    return { nodes: createdNodes, references: [] };
  },

  resolve(_ref: UnresolvedRef, _context: ResolutionContext): ResolvedRef | null {
    return null;
  },
};
