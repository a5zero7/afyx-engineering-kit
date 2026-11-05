/**
 * AFYX Engineering Kit - Resolution Engine
 * Subsystem: Framework Resolvers (Swift <-> Objective-C Cross-Language Bridge)
 *
 * Connects cross-language invocations between Swift and Objective-C components in
 * mixed iOS/macOS codebases by mapping bridged selector names and @objc declarations.
 */

import type { Node } from '../../types';
import type {
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import {
  isObjcExposed,
  swiftBaseNamesForObjcSelector,
} from '../swift-objc-bridge';

/** Confidence assigned to bridge-resolved cross-language links */
const BRIDGE_LINK_CONFIDENCE = 0.6;

/** Number of source lines preceding the definition line to inspect for @objc annotations */
const ATTRIBUTE_SCAN_WINDOW_LINES = 3;

/**
 * Common Foundation / NSObject selector base names that occur across many classes
 * and should not be ambiguously linked across the bridge when resolving bare references.
 */
const COMMON_SELECTOR_NAMES = new Set<string>([
  'init',
  'description',
  'debugDescription',
  'hash',
  'isEqual',
  'isEqualTo',
  'copy',
  'mutableCopy',
  'class',
  'self',
  'count',
  'length',
  'value',
  'name',
  'data',
  'string',
  'object',
  'add',
  'remove',
  'update',
  'load',
  'save',
  'reload',
  'cancel',
  'start',
  'stop',
  'pause',
  'resume',
  'close',
  'open',
  'show',
  'hide',
  'toString',
  'dealloc',
  'release',
  'retain',
  'autorelease',
]);

/** Cache mapping ResolutionContext -> (candidate Swift base name -> ObjC method nodes) */
const contextObjcMethodRegistry = new WeakMap<ResolutionContext, Map<string, Node[]>>();

/**
 * Constructs or retrieves the reverse bridging directory:
 * Maps candidate Swift base names to the Objective-C method nodes whose selectors bridge to them.
 */
function getOrBuildObjcRegistry(context: ResolutionContext): Map<string, Node[]> {
  const cached = contextObjcMethodRegistry.get(context);
  if (cached) {
    return cached;
  }

  const directory = new Map<string, Node[]>();
  const objcMethodNodes = context
    .getNodesByKind('method')
    .filter((node) => node.language === 'objc');

  for (const methodNode of objcMethodNodes) {
    const candidateSwiftBases = swiftBaseNamesForObjcSelector(methodNode.name);
    for (const baseName of candidateSwiftBases) {
      // Discard identity mappings for selectors lacking arguments (native name matcher covers these)
      if (baseName === methodNode.name && !methodNode.name.includes(':')) {
        continue;
      }

      // Filter out overly broad NSObject convention identifiers
      if (COMMON_SELECTOR_NAMES.has(baseName)) {
        continue;
      }

      const existingGroup = directory.get(baseName);
      if (existingGroup) {
        existingGroup.push(methodNode);
      } else {
        directory.set(baseName, [methodNode]);
      }
    }
  }

  contextObjcMethodRegistry.set(context, directory);
  return directory;
}

/**
 * Extracts a multi-line source snippet surrounding the declaration start line
 * to detect presence of `@objc` or `@nonobjc` markers.
 */
function readDeclarationContext(node: Node, context: ResolutionContext): string {
  const content = context.readFile(node.filePath);
  if (!content) {
    return '';
  }

  const lines = content.split(/\r?\n/);
  const start = Math.max(0, node.startLine - 1 - ATTRIBUTE_SCAN_WINDOW_LINES);
  const end = Math.min(lines.length, node.startLine);
  return lines.slice(start, end).join('\n');
}

/**
 * Resolves an invocation from Swift source targeting an Objective-C selector.
 */
function resolveSwiftCallerToObjc(
  ref: UnresolvedRef,
  context: ResolutionContext
): ResolvedRef | null {
  const dotIndex = ref.referenceName.lastIndexOf('.');
  const bareIdentifier = dotIndex !== -1
    ? ref.referenceName.slice(dotIndex + 1)
    : ref.referenceName;

  const registry = getOrBuildObjcRegistry(context);
  const matches = registry.get(bareIdentifier);
  if (!matches || matches.length === 0) {
    return null;
  }

  const targetNode = matches[0];
  if (!targetNode) {
    return null;
  }

  return {
    original: ref,
    targetNodeId: targetNode.id,
    confidence: BRIDGE_LINK_CONFIDENCE,
    resolvedBy: 'framework',
  };
}

/**
 * Resolves an Objective-C message expression targeting an `@objc`-exposed Swift function or method.
 */
function resolveObjcCallerToSwift(
  ref: UnresolvedRef,
  context: ResolutionContext
): ResolvedRef | null {
  const dotIndex = ref.referenceName.lastIndexOf('.');
  const bareSelector = dotIndex !== -1
    ? ref.referenceName.slice(dotIndex + 1)
    : ref.referenceName;

  if (!bareSelector.includes(':')) {
    return null;
  }

  const candidateSwiftNames = swiftBaseNamesForObjcSelector(bareSelector);
  for (const candidateName of candidateSwiftNames) {
    const candidateNodes = context
      .getNodesByName(candidateName)
      .filter((node) => node.language === 'swift' && (node.kind === 'method' || node.kind === 'function'));

    for (const swiftNode of candidateNodes) {
      const sourceWindow = readDeclarationContext(swiftNode, context);
      if (isObjcExposed(sourceWindow)) {
        return {
          original: ref,
          targetNodeId: swiftNode.id,
          confidence: BRIDGE_LINK_CONFIDENCE,
          resolvedBy: 'framework',
        };
      }
    }
  }

  return null;
}

export const swiftObjcBridgeResolver: FrameworkResolver = {
  name: 'swift-objc-bridge',
  languages: ['swift', 'objc'],

  detect(context: ResolutionContext): boolean {
    const projectFiles = context.getAllFiles();
    let containsSwift = false;
    let containsObjc = false;

    for (let i = 0; i < projectFiles.length; i++) {
      const file = projectFiles[i]!;
      if (file.endsWith('.swift')) {
        containsSwift = true;
      } else if (file.endsWith('.m') || file.endsWith('.mm')) {
        containsObjc = true;
      }

      if (containsSwift && containsObjc) {
        return true;
      }
    }

    return false;
  },

  claimsReference(name: string): boolean {
    return name.includes(':');
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.language === 'swift') {
      return resolveSwiftCallerToObjc(ref, context);
    }
    if (ref.language === 'objc') {
      return resolveObjcCallerToSwift(ref, context);
    }
    return null;
  },
};
