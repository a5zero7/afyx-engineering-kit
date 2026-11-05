/**
 * AFYX Engineering Kit - Resolution Engine
 * Subsystem: Framework Resolvers (Apple Swift - SwiftUI, UIKit, and Vapor Server)
 *
 * Implements architectural symbol extraction and pattern-based resolution for
 * Apple ecosystem client applications (SwiftUI, UIKit) and server-side Swift (Vapor).
 */

import type { Node } from '../../types';
import type {
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { stripCommentsForRegex } from '../strip-comments';

/** Architectural directory patterns for SwiftUI */
const SWIFTUI_VIEW_DIRS = ['/Views/', '/View/', '/Screens/', '/Components/', '/UI/'];
const SWIFTUI_VIEWMODEL_DIRS = ['/ViewModels/', '/ViewModel/', '/Stores/', '/Managers/', '/Services/'];
const SWIFT_MODEL_DIRS = ['/Models/', '/Model/', '/Entities/', '/Domain/'];

/** Architectural directory patterns for UIKit */
const UIKIT_VC_DIRS = ['/ViewControllers/', '/ViewController/', '/Controllers/', '/Screens/'];
const UIKIT_VIEW_DIRS = ['/Views/', '/View/', '/UI/', '/Components/'];
const UIKIT_CELL_DIRS = ['/Cells/', '/Cell/', '/Views/', '/TableViewCells/', '/CollectionViewCells/'];

/** Architectural directory patterns for Vapor */
const VAPOR_CONTROLLER_DIRS = ['/Controllers/', '/Controller/', '/Routes/'];
const VAPOR_FLUENT_DIRS = ['/Models/', '/Model/', '/Entities/', '/Database/'];
const VAPOR_MIDDLEWARE_DIRS = ['/Middleware/', '/Middlewares/'];

/** Node kind classifications */
const COMPONENT_KINDS = new Set<string>(['struct', 'component']);
const CLASS_KINDS = new Set<string>(['class']);
const STRUCT_OR_CLASS_KINDS = new Set<string>(['struct', 'class']);
const PROTOCOL_KINDS = new Set<string>(['protocol']);

/**
 * Searches candidates by symbol name and matches kind restrictions, prioritizing
 * candidates residing within conventional architectural folders.
 */
function findSymbolByKindAndDirectory(
  symbolName: string,
  acceptedKinds: Set<string>,
  preferredPathFragments: string[],
  context: ResolutionContext
): string | null {
  const matches = context.getNodesByName(symbolName);
  if (matches.length === 0) {
    return null;
  }

  const kindMatches = matches.filter((node) => acceptedKinds.has(node.kind));
  if (kindMatches.length === 0) {
    return null;
  }

  if (preferredPathFragments.length > 0) {
    const conventionMatch = kindMatches.find((node) =>
      preferredPathFragments.some((fragment) => node.filePath.includes(fragment))
    );
    if (conventionMatch) {
      return conventionMatch.id;
    }
  }

  return kindMatches[0]!.id;
}

// ============================================================================
// 1. SwiftUI Resolver
// ============================================================================

export const swiftUIResolver: FrameworkResolver = {
  name: 'swiftui',
  languages: ['swift'],

  detect(context: ResolutionContext): boolean {
    const files = context.getAllFiles();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      if (file.endsWith('.swift')) {
        const source = context.readFile(file);
        if (source && source.includes('import SwiftUI')) {
          return true;
        }
      } else if (file.endsWith('.xcodeproj') || file.endsWith('.xcworkspace')) {
        return true;
      }
    }
    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    const { referenceName } = ref;

    // View component conventions: PascalCase ending in View
    if (referenceName.endsWith('View') && /^[A-Z]/.test(referenceName)) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        COMPONENT_KINDS,
        SWIFTUI_VIEW_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    // State container / ViewModel conventions
    if (
      referenceName.endsWith('ViewModel') ||
      referenceName.endsWith('Store') ||
      referenceName.endsWith('Manager')
    ) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        CLASS_KINDS,
        SWIFTUI_VIEWMODEL_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    // Domain Model entities
    if (/^[A-Z][a-zA-Z]+$/.test(referenceName)) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        STRUCT_OR_CLASS_KINDS,
        SWIFT_MODEL_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.7, resolvedBy: 'framework' };
      }
    }

    return null;
  },

  extract(filePath: string, content: string) {
    if (!filePath.endsWith('.swift')) {
      return { nodes: [], references: [] };
    }

    const nodes: Node[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'swift');

    // Detect struct definitions conforming to View: `struct MyView: View`
    const viewStructPattern = /struct\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*View/g;
    let match: RegExpExecArray | null;
    while ((match = viewStructPattern.exec(cleanSource)) !== null) {
      const viewName = match[1]!;
      const line = cleanSource.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `view:${filePath}:${viewName}:${line}`,
        kind: 'component',
        name: viewName,
        qualifiedName: `${filePath}::${viewName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'swift',
        updatedAt: timestamp,
      });
    }

    // Detect SwiftUI App entry point: `@main struct MyApp: App`
    const appEntryPattern = /@main\s+struct\s+(\w+)\s*:\s*App/g;
    while ((match = appEntryPattern.exec(cleanSource)) !== null) {
      const appName = match[1]!;
      const line = cleanSource.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `app:${filePath}:${appName}:${line}`,
        kind: 'class',
        name: appName,
        qualifiedName: `${filePath}::${appName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'swift',
        updatedAt: timestamp,
      });
    }

    return { nodes, references: [] };
  },
};

// ============================================================================
// 2. UIKit Resolver
// ============================================================================

export const uikitResolver: FrameworkResolver = {
  name: 'uikit',
  languages: ['swift'],

  detect(context: ResolutionContext): boolean {
    const files = context.getAllFiles();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      if (file.endsWith('.swift')) {
        const source = context.readFile(file);
        if (
          source &&
          (source.includes('import UIKit') ||
            source.includes('UIViewController') ||
            source.includes('UIView'))
        ) {
          return true;
        }
      }
    }
    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    const { referenceName } = ref;

    if (referenceName.endsWith('ViewController')) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        CLASS_KINDS,
        UIKIT_VC_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    if (referenceName.endsWith('View') && !referenceName.endsWith('ViewController')) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        CLASS_KINDS,
        UIKIT_VIEW_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.8, resolvedBy: 'framework' };
      }
    }

    if (referenceName.endsWith('Cell')) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        CLASS_KINDS,
        UIKIT_CELL_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    if (referenceName.endsWith('Delegate') || referenceName.endsWith('DataSource')) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        PROTOCOL_KINDS,
        [],
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.8, resolvedBy: 'framework' };
      }
    }

    return null;
  },

  extract(filePath: string, content: string) {
    if (!filePath.endsWith('.swift')) {
      return { nodes: [], references: [] };
    }

    const nodes: Node[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'swift');

    // UIViewController inheritance
    const vcPattern = /class\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*UIViewController/g;
    let match: RegExpExecArray | null;
    while ((match = vcPattern.exec(cleanSource)) !== null) {
      const vcName = match[1]!;
      const line = cleanSource.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `viewcontroller:${filePath}:${vcName}:${line}`,
        kind: 'class',
        name: vcName,
        qualifiedName: `${filePath}::${vcName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'swift',
        updatedAt: timestamp,
      });
    }

    // UIView inheritance (excluding UIViewController)
    const viewPattern = /class\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*UIView[^C]/g;
    while ((match = viewPattern.exec(cleanSource)) !== null) {
      const viewName = match[1]!;
      const line = cleanSource.slice(0, match.index).split('\n').length;

      nodes.push({
        id: `uiview:${filePath}:${viewName}:${line}`,
        kind: 'class',
        name: viewName,
        qualifiedName: `${filePath}::${viewName}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'swift',
        updatedAt: timestamp,
      });
    }

    return { nodes, references: [] };
  },
};

// ============================================================================
// 3. Vapor Server Resolver
// ============================================================================

export const vaporResolver: FrameworkResolver = {
  name: 'vapor',
  languages: ['swift'],

  detect(context: ResolutionContext): boolean {
    const packageManifest = context.readFile('Package.swift');
    if (packageManifest && packageManifest.includes('vapor')) {
      return true;
    }

    const files = context.getAllFiles();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      if (file.endsWith('.swift')) {
        const source = context.readFile(file);
        if (source && source.includes('import Vapor')) {
          return true;
        }
      }
    }
    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    const { referenceName } = ref;

    if (referenceName.endsWith('Controller')) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        STRUCT_OR_CLASS_KINDS,
        VAPOR_CONTROLLER_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    if (/^[A-Z][a-zA-Z]+$/.test(referenceName)) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        CLASS_KINDS,
        VAPOR_FLUENT_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.75, resolvedBy: 'framework' };
      }
    }

    if (referenceName.endsWith('Middleware')) {
      const targetId = findSymbolByKindAndDirectory(
        referenceName,
        STRUCT_OR_CLASS_KINDS,
        VAPOR_MIDDLEWARE_DIRS,
        context
      );
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.8, resolvedBy: 'framework' };
      }
    }

    return null;
  },

  extract(filePath: string, content: string) {
    if (!filePath.endsWith('.swift')) {
      return { nodes: [], references: [] };
    }

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'swift');

    // Helper to concatenate path segments from string literals
    const appendSegments = (prefix: string, segmentArgs: string): string => {
      const literalMatches = segmentArgs.match(/"([^"]*)"/g);
      if (!literalMatches) {
        return prefix;
      }
      const rawSegments = literalMatches.map((token) => token.slice(1, -1));
      return prefix + rawSegments.map((segment) => '/' + segment).join('');
    };

    // Track route builder prefixes: variable name -> mounted URL prefix
    const routeGroupPrefixMap = new Map<string, string>();

    // 1. `let todos = routes.grouped("todos")`
    const groupedAssignmentPattern = /\blet\s+(\w+)\s*=\s*(\w+)\.grouped\s*\(([^)]*)\)/g;
    let groupMatch: RegExpExecArray | null;
    while ((groupMatch = groupedAssignmentPattern.exec(cleanSource)) !== null) {
      const [, targetVar, parentVar, args] = groupMatch;
      const parentPrefix = routeGroupPrefixMap.get(parentVar!) ?? '';
      routeGroupPrefixMap.set(targetVar!, appendSegments(parentPrefix, args!));
    }

    // 2. `routes.group("todos") { todo in ... }`
    const groupClosurePattern = /\b(\w+)\.group\s*\(([^)]*)\)\s*\{\s*(\w+)\s+in/g;
    while ((groupMatch = groupClosurePattern.exec(cleanSource)) !== null) {
      const [, parentVar, args, scopedVar] = groupMatch;
      const parentPrefix = routeGroupPrefixMap.get(parentVar!) ?? '';
      routeGroupPrefixMap.set(scopedVar!, appendSegments(parentPrefix, args!));
    }

    // 3. Endpoint registration: `routes.get("path", use: handler)`
    // Strict linear regex avoiding exponential backtracking on long parameter lists
    const routeDefinitionPattern = /\b(\w+)\.(get|post|put|patch|delete|head|options)\s*\(\s*((?:[^,()]+,)*\s*)use:\s*([A-Za-z_][\w.]*)/g;
    let routeMatch: RegExpExecArray | null;

    while ((routeMatch = routeDefinitionPattern.exec(cleanSource)) !== null) {
      const [, builderVar, httpMethod, segmentArguments, handlerExpr] = routeMatch;
      const line = cleanSource.slice(0, routeMatch.index).split('\n').length;
      const methodUpper = httpMethod!.toUpperCase();

      const basePrefix = routeGroupPrefixMap.get(builderVar!) ?? '';
      const constructedPath = appendSegments(basePrefix, segmentArguments!) || '/';

      const routeNode: Node = {
        id: `route:${filePath}:${line}:${methodUpper}:${constructedPath}`,
        kind: 'route',
        name: `${methodUpper} ${constructedPath}`,
        qualifiedName: `${filePath}::route:${constructedPath}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: routeMatch[0].length,
        language: 'swift',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      // Extract terminal method/function name from handler expression (e.g., self.edit -> edit)
      const targetHandlerName = handlerExpr!.split('.').pop();
      if (targetHandlerName) {
        references.push({
          fromNodeId: routeNode.id,
          referenceName: targetHandlerName,
          referenceKind: 'references',
          line,
          column: 0,
          filePath,
          language: 'swift',
        });
      }
    }

    return { nodes, references };
  },
};
