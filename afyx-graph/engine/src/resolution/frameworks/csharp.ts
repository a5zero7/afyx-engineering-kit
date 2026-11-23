/**
 * AFYX Engineering Kit - C# & ASP.NET Framework Resolver
 *
 * Implements route declaration extraction and architecture resolution for ASP.NET applications:
 * 1. ASP.NET Core / MVC attribute routing: `[Route("...")][HttpGet]`, `[HttpPost("...")]`
 * 2. Minimal APIs: `app.MapGet(...)`, `app.MapPost(...)`
 * 3. Endpoint-group patterns (`IEndpointGroup`, `EndpointGroupBase`) and `MapGroup` prefix resolution in `postExtract`
 * 4. Resolves Controller, Service interfaces (`IService`), Repositories, Domain Models, and DTOs
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

const PREFERRED_CONTROLLER_DIRECTORIES: readonly string[] = ['/Controllers/'];
const PREFERRED_SERVICE_DIRECTORIES: readonly string[] = ['/Services/', '/Service/', '/Application/'];
const PREFERRED_REPOSITORY_DIRECTORIES: readonly string[] = ['/Repositories/', '/Repository/', '/Data/', '/Infrastructure/'];
const PREFERRED_MODEL_DIRECTORIES: readonly string[] = ['/Models/', '/Model/', '/Entities/', '/Entity/', '/Domain/'];
const PREFERRED_VIEWMODEL_DIRECTORIES: readonly string[] = ['/ViewModels/', '/ViewModel/', '/DTOs/', '/Dto/'];

const CLASS_NODE_TYPES: ReadonlySet<string> = new Set(['class']);
const SERVICE_NODE_TYPES: ReadonlySet<string> = new Set(['class', 'interface']);

function combineCSharpUrlPaths(prefix: string, subPath: string): string {
  const parts = [prefix, subPath].map((seg) => seg.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${parts.join('/')}`;
}

function extractLastIdentifierFromCSharpExpr(expr: string): string | null {
  const cleaned = expr.trim().replace(/\s+/g, '');
  const match = cleaned.match(/(?:\.|^)([A-Za-z_][A-Za-z0-9_]*)$/);
  return match ? match[1]! : null;
}

function locateCandidateByDirectoryHeuristic(
  name: string,
  kindFilter: ReadonlySet<string>,
  directoryKeywords: readonly string[],
  ctx: ResolutionContext
): string | null {
  const matchingNodes = ctx.getNodesByName(name);
  if (matchingNodes.length === 0) return null;

  const validKinds = matchingNodes.filter((n) => kindFilter.has(n.kind));
  if (validKinds.length === 0) return null;

  const inPreferredDirs = validKinds.filter((n) =>
    directoryKeywords.some((keyword) => n.filePath.includes(keyword))
  );

  return inPreferredDirs.length > 0 ? inPreferredDirs[0]!.id : validKinds[0]!.id;
}

export const aspnetResolver: FrameworkResolver = {
  name: 'aspnet',
  languages: ['csharp'],

  detect(context: ResolutionContext): boolean {
    const allFiles = context.getAllFiles();

    for (const f of allFiles) {
      if (f.endsWith('.csproj')) {
        const text = context.readFile(f);
        if (
          text &&
          (text.includes('Microsoft.AspNetCore') ||
            text.includes('Microsoft.NET.Sdk.Web') ||
            text.includes('System.Web.Mvc'))
        ) {
          return true;
        }
      }
    }

    const programFile = context.readFile('Program.cs');
    if (
      programFile &&
      (programFile.includes('WebApplication') ||
        programFile.includes('CreateHostBuilder') ||
        programFile.includes('UseStartup'))
    ) {
      return true;
    }

    if (context.fileExists('Startup.cs')) return true;

    for (const f of allFiles) {
      if (
        !/(?:Controller|Program|Startup|Endpoints?|Extensions)\.cs$/.test(f) &&
        !/(?:^|\/)Endpoints\/[^/]+\.cs$/.test(f)
      ) {
        continue;
      }

      const text = context.readFile(f);
      if (
        text &&
        (/\[(?:ApiController|Route|Http(?:Get|Post|Put|Patch|Delete))\b/.test(text) ||
          text.includes('ControllerBase') ||
          text.includes(': Controller') ||
          text.includes('MapControllers') ||
          text.includes('WebApplication') ||
          text.includes('Microsoft.AspNetCore') ||
          text.includes('IEndpointGroup') ||
          text.includes('EndpointGroupBase') ||
          text.includes('RouteGroupBuilder'))
      ) {
        return true;
      }
    }

    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceName.endsWith('Controller')) {
      const matchId = locateCandidateByDirectoryHeuristic(
        ref.referenceName,
        CLASS_NODE_TYPES,
        PREFERRED_CONTROLLER_DIRECTORIES,
        context
      );
      if (matchId) {
        return { original: ref, targetNodeId: matchId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    if (
      ref.referenceName.endsWith('Service') ||
      (ref.referenceName.startsWith('I') && ref.referenceName.length > 1)
    ) {
      const matchId = locateCandidateByDirectoryHeuristic(
        ref.referenceName,
        SERVICE_NODE_TYPES,
        PREFERRED_SERVICE_DIRECTORIES,
        context
      );
      if (matchId) {
        return { original: ref, targetNodeId: matchId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    if (ref.referenceName.endsWith('Repository')) {
      const matchId = locateCandidateByDirectoryHeuristic(
        ref.referenceName,
        SERVICE_NODE_TYPES,
        PREFERRED_REPOSITORY_DIRECTORIES,
        context
      );
      if (matchId) {
        return { original: ref, targetNodeId: matchId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const matchId = locateCandidateByDirectoryHeuristic(
        ref.referenceName,
        CLASS_NODE_TYPES,
        PREFERRED_MODEL_DIRECTORIES,
        context
      );
      if (matchId) {
        return { original: ref, targetNodeId: matchId, confidence: 0.7, resolvedBy: 'framework' };
      }
    }

    if (ref.referenceName.endsWith('ViewModel') || ref.referenceName.endsWith('Dto')) {
      const matchId = locateCandidateByDirectoryHeuristic(
        ref.referenceName,
        CLASS_NODE_TYPES,
        PREFERRED_VIEWMODEL_DIRECTORIES,
        context
      );
      if (matchId) {
        return { original: ref, targetNodeId: matchId, confidence: 0.8, resolvedBy: 'framework' };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.cs')) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'csharp');

    let classPrefix = '';
    const classRouteMatch =
      /\[Route\s*\(\s*"([^"]+)"[^)]*\)\]\s*(?:\[[^\]]*\]\s*)*(?:public\s+|sealed\s+|abstract\s+|partial\s+)*class\b/.exec(
        cleanSource
      );
    if (classRouteMatch) {
      classPrefix = classRouteMatch[1]!;
    }

    const attributeRoutePattern =
      /\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete)(?:\s*\(\s*"([^"]+)"[^)]*\))?\s*\]/g;
    let match: RegExpExecArray | null;

    while ((match = attributeRoutePattern.exec(cleanSource)) !== null) {
      const rawVerb = match[1]!;
      const method = rawVerb.replace(/^Http/, '').toUpperCase();
      const endpoint = combineCSharpUrlPaths(classPrefix, match[2] || '');
      const lineNumber = cleanSource.slice(0, match.index).split('\n').length;

      const routeNode: Node = {
        id: `route:${filePath}:${lineNumber}:${method}:${endpoint}`,
        kind: 'route',
        name: `${method} ${endpoint}`,
        qualifiedName: `${filePath}::route:${endpoint}`,
        filePath,
        startLine: lineNumber,
        endLine: lineNumber,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'csharp',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      const methodSnippet = cleanSource.slice(
        match.index + match[0].length,
        match.index + match[0].length + 600
      );
      const actionMatch = methodSnippet.match(
        /(?:public|private|protected|internal)\s+[\w<>,\s\[\]?.]+?\s+(\w+)\s*\(/
      );

      if (actionMatch) {
        references.push({
          fromNodeId: routeNode.id,
          referenceName: actionMatch[1]!,
          referenceKind: 'references',
          line: lineNumber,
          column: 0,
          filePath,
          language: 'csharp',
        });
      }
    }

    const minimalApiPattern = /\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"\s*,\s*([^,)]+)/g;
    while ((match = minimalApiPattern.exec(cleanSource)) !== null) {
      const verb = match[1]!.toUpperCase();
      const endpoint = match[2]!;
      const handlerExpr = match[3]!;
      const lineNumber = cleanSource.slice(0, match.index).split('\n').length;

      const routeNode: Node = {
        id: `route:${filePath}:${lineNumber}:${verb}:${endpoint}`,
        kind: 'route',
        name: `${verb} ${endpoint}`,
        qualifiedName: `${filePath}::route:${endpoint}`,
        filePath,
        startLine: lineNumber,
        endLine: lineNumber,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'csharp',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      const handlerIdent = extractLastIdentifierFromCSharpExpr(handlerExpr);
      if (handlerIdent) {
        references.push({
          fromNodeId: routeNode.id,
          referenceName: handlerIdent,
          referenceKind: 'references',
          line: lineNumber,
          column: 0,
          filePath,
          language: 'csharp',
        });
      }
    }

    const groupApiPattern = /\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*([A-Za-z_]\w*)\s*(?:,\s*"([^"]*)")?\s*\)/g;
    const explicitPrefixMatch = /\bRoutePrefix\s*(?:=>|=)\s*"([^"]+)"/.exec(cleanSource);

    while ((match = groupApiPattern.exec(cleanSource)) !== null) {
      const verb = match[1]!.toUpperCase();
      const handlerName = match[2]!;
      const subPath = match[3];
      const lineNumber = cleanSource.slice(0, match.index).split('\n').length;
      const precedingContent = cleanSource.slice(0, match.index);

      const classMatches = [...precedingContent.matchAll(/\bclass\s+([A-Za-z_]\w*)/g)];
      const lastClass = classMatches.pop();
      if (!lastClass) continue;

      const groupName = lastClass[1]!;
      const groupBase = explicitPrefixMatch ? explicitPrefixMatch[1]! : `/${groupName}`;
      const endpoint = combineCSharpUrlPaths(groupBase, subPath ?? '');

      const routeNode: Node = {
        id: `route:${filePath}:${lineNumber}:${verb}:${endpoint}`,
        kind: 'route',
        name: `${verb} ${endpoint}`,
        qualifiedName: `${filePath}::group:${groupName}:${verb}:${subPath ?? ''}`,
        filePath,
        startLine: lineNumber,
        endLine: lineNumber,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'csharp',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      references.push({
        fromNodeId: routeNode.id,
        referenceName: handlerName,
        referenceKind: 'references',
        line: lineNumber,
        column: 0,
        filePath,
        language: 'csharp',
      });
    }

    return { nodes, references };
  },

  postExtract(context: ResolutionContext): Node[] {
    let globalGroupHead: string | null = null;
    let scannedCount = 0;

    for (const f of context.getAllFiles()) {
      if (!f.endsWith('.cs')) continue;
      const content = context.readFile(f);
      if (!content || !content.includes('MapGroup')) continue;
      if (++scannedCount > 400) break;

      const match =
        /\$"([^"{]*)\{\s*(?:groupName|type\.Name|name|prefix)\s*\}"/.exec(content) ??
        /MapGroup\(\s*\$"([^"{]*)\{/.exec(content);

      if (match) {
        globalGroupHead = match[1]!;
        break;
      }
    }

    if (!globalGroupHead || globalGroupHead === '/' || globalGroupHead === '') return [];

    const updatedRouteNodes: Node[] = [];
    for (const route of context.getNodesByKind('route')) {
      if (route.language !== 'csharp') continue;

      const groupMatch = /::group:([A-Za-z_]\w*):([A-Z]+):(.*)$/.exec(route.qualifiedName);
      if (!groupMatch) continue;

      const fileContent = context.readFile(route.filePath);
      if (fileContent && /\bRoutePrefix\s*(?:=>|=)\s*"/.test(fileContent)) continue;

      const formattedPath = combineCSharpUrlPaths(
        `${globalGroupHead.replace(/\/+$/, '')}/${groupMatch[1]!}`,
        groupMatch[3]!
      );
      const newRouteName = `${groupMatch[2]!} ${formattedPath}`;

      if (newRouteName !== route.name) {
        updatedRouteNodes.push({ ...route, name: newRouteName });
      }
    }

    return updatedRouteNodes;
  },
};
