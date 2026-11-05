/**
 * AFYX Engineering Kit - Resolution Engine
 * Subsystem: Framework Resolvers (HashiCorp Terraform & OpenTofu HCL Scoping)
 *
 * Implements lexical and directory-bound scoping rules for Terraform/OpenTofu:
 * 1. Directory-isolated variable, local, and resource referencing
 * 2. Ancestor lookup for `.tfvars` file assignments and inherited provider configurations
 * 3. Inter-module wiring via scoped module references (`module.M:file`, `module.M:var.X`, `module.M:output.X`)
 * 4. Component remote-state output bridges
 */

import * as path from 'path';
import type { Node } from '../../types';
import type {
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';

/** Pattern for synthetic inter-module reference syntax */
const SCOPED_MODULE_REF_PATTERN = /^module\.([^.:\s]+):(file$|var\.|output\.|remote-output\.)/;

/** High-confidence score for directory-local Terraform symbol bindings */
const LOCAL_SCOPE_CONFIDENCE = 0.95;

/** Confidence score for hierarchical ancestor searches (.tfvars, shared providers) */
const ANCESTOR_SCOPE_CONFIDENCE = 0.9;

/**
 * Returns project-relative directory path using POSIX separators.
 */
function getDirectory(filePath: string): string {
  const dir = path.dirname(filePath);
  return dir === '' ? '.' : dir;
}

/**
 * Returns parent directory path, or null when root is reached.
 */
function getParentDirectory(dirPath: string): string | null {
  if (dirPath === '.' || dirPath === '') {
    return null;
  }
  const parent = path.dirname(dirPath);
  return parent === dirPath ? null : parent;
}

/**
 * Joins a directory and a relative module path, normalizing to forward slashes.
 */
function resolveNormalizedPath(baseDir: string, relativeTarget: string): string {
  const combined = path.join(baseDir === '.' ? '' : baseDir, relativeTarget);
  const normalized = path.normalize(combined).replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized === '' ? '.' : normalized;
}

/**
 * Walks upward from the reference directory to locate the nearest ancestor declaring candidate.
 */
function locateNearestAncestorNode<T extends { filePath: string }>(
  candidateNodes: T[],
  originDirectory: string
): T | null {
  for (let current = getParentDirectory(originDirectory); current !== null; current = getParentDirectory(current)) {
    const matched = candidateNodes.filter((candidate) => getDirectory(candidate.filePath) === current);
    if (matched.length > 0) {
      return matched[0]!;
    }
  }
  return null;
}

/**
 * Reads lines across a node's declaration span and returns the first regex capture.
 */
function extractDeclarationRegexMatch(
  node: Node,
  pattern: RegExp,
  context: ResolutionContext
): string | null {
  const lines =
    context.getFileLines?.(node.filePath) ??
    context.readFile(node.filePath)?.split('\n') ??
    null;

  if (!lines) {
    return null;
  }

  const startLineIdx = Math.max(0, node.startLine - 1);
  const endLineIdx = Math.min(lines.length, node.endLine);

  for (let i = startLineIdx; i < endLineIdx; i++) {
    const match = lines[i]!.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Extracts a literal string attribute from a module declaration block.
 */
function readModuleStringAttribute(
  declNode: Node,
  attributeName: string,
  context: ResolutionContext
): string | null {
  const attrPattern = new RegExp(`^\\s*${attributeName}\\s*=\\s*"([^"]+)"`);
  return extractDeclarationRegexMatch(declNode, attrPattern, context);
}

/**
 * Resolves scoped inter-module syntax: `module.M:file`, `module.M:var.X`, `module.M:output.X`
 */
function resolveModuleBoundaryLink(
  ref: UnresolvedRef,
  moduleName: string,
  targetSpecifier: string,
  currentDir: string,
  context: ResolutionContext
): ResolvedRef | null {
  const moduleDeclarations = context
    .getNodesByQualifiedName(`module.${moduleName}`)
    .filter((node) => node.kind === 'module');

  if (moduleDeclarations.length === 0) {
    return null;
  }

  const localDecl =
    moduleDeclarations.find((decl) => getDirectory(decl.filePath) === currentDir) ??
    (moduleDeclarations.length === 1 ? moduleDeclarations[0]! : null);

  if (!localDecl) {
    return null;
  }

  const sourcePath = readModuleStringAttribute(localDecl, 'source', context);
  if (!sourcePath) {
    return null;
  }

  // Handle remote-state component output resolution (e.g. CloudPosse / Atmos patterns)
  if (targetSpecifier.startsWith('remote-output.')) {
    if (!/\/remote-state(\/|$)/.test(sourcePath)) {
      return null;
    }

    let targetComponent = readModuleStringAttribute(localDecl, 'component', context);
    if (!targetComponent) {
      // Check variable indirection: component = var.vpc_name
      const varReferencePattern = /^\s*component\s*=\s*var\.([A-Za-z0-9_-]+)\s*$/;
      const indirectVarName = extractDeclarationRegexMatch(localDecl, varReferencePattern, context);
      if (indirectVarName) {
        const matchingVars = context
          .getNodesByQualifiedName(`var.${indirectVarName}`)
          .filter((v) => getDirectory(v.filePath) === getDirectory(localDecl.filePath));

        if (matchingVars.length === 1) {
          targetComponent = extractDeclarationRegexMatch(
            matchingVars[0]!,
            /^\s*default\s*=\s*"([^"]+)"/,
            context
          );
        }
      }
    }

    if (!targetComponent) {
      return null;
    }

    const outputName = targetSpecifier.slice('remote-output.'.length);
    const candidateOutputs = context
      .getNodesByQualifiedName(`output.${outputName}`)
      .filter((outputNode) => {
        const outDir = getDirectory(outputNode.filePath);
        return outDir === targetComponent || outDir.endsWith('/' + targetComponent);
      });

    if (candidateOutputs.length === 0) {
      return null;
    }

    // Ensure ambiguity-free resolution
    const distinctDirs = new Set(candidateOutputs.map((out) => getDirectory(out.filePath)));
    if (distinctDirs.size > 1) {
      return null;
    }

    return {
      original: ref,
      targetNodeId: candidateOutputs[0]!.id,
      confidence: ANCESTOR_SCOPE_CONFIDENCE,
      resolvedBy: 'framework',
    };
  }

  // Only resolve project-local relative source paths
  if (!sourcePath.startsWith('./') && !sourcePath.startsWith('../')) {
    return null;
  }

  const targetModuleDir = resolveNormalizedPath(getDirectory(localDecl.filePath), sourcePath);

  // Link to module primary file entry
  if (targetSpecifier === 'file') {
    const moduleHclFiles = context
      .getAllFiles()
      .filter(
        (filePath) =>
          getDirectory(filePath) === targetModuleDir &&
          (filePath.endsWith('.tf') || filePath.endsWith('.tofu'))
      )
      .sort();

    if (moduleHclFiles.length === 0) {
      return null;
    }

    const mainFile =
      moduleHclFiles.find((filePath) => filePath.endsWith('/main.tf') || filePath === 'main.tf') ??
      moduleHclFiles[0]!;

    const fileNode = context.getNodesInFile(mainFile).find((node) => node.kind === 'file');
    if (!fileNode) {
      return null;
    }

    return {
      original: ref,
      targetNodeId: fileNode.id,
      confidence: LOCAL_SCOPE_CONFIDENCE,
      resolvedBy: 'framework',
    };
  }

  // Link to specific child variable or output (`var.X` or `output.X`)
  const targetDeclarations = context
    .getNodesByQualifiedName(targetSpecifier)
    .filter((node) => getDirectory(node.filePath) === targetModuleDir);

  if (targetDeclarations.length === 0) {
    return null;
  }

  return {
    original: ref,
    targetNodeId: targetDeclarations[0]!.id,
    confidence: LOCAL_SCOPE_CONFIDENCE,
    resolvedBy: 'framework',
  };
}

export const terraformResolver: FrameworkResolver = {
  name: 'terraform',
  languages: ['terraform'],

  detect(context: ResolutionContext): boolean {
    const files = context.getAllFiles();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      if (file.endsWith('.tf') || file.endsWith('.tfvars') || file.endsWith('.tofu')) {
        return true;
      }
    }
    return false;
  },

  claimsReference(name: string): boolean {
    return SCOPED_MODULE_REF_PATTERN.test(name);
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.language !== 'terraform') {
      return null;
    }

    const targetQualifiedName = ref.referenceName;
    const originDir = getDirectory(ref.filePath);

    // Scoped module syntax handling
    const moduleScopedMatch = targetQualifiedName.match(/^module\.([^.:\s]+):(.+)$/);
    if (moduleScopedMatch) {
      return resolveModuleBoundaryLink(
        ref,
        moduleScopedMatch[1]!,
        moduleScopedMatch[2]!,
        originDir,
        context
      );
    }

    const matchingCandidates = context.getNodesByQualifiedName(targetQualifiedName);
    if (matchingCandidates.length === 0) {
      return null;
    }

    // 1. Same directory resolution (standard HCL module boundary)
    const localMatches = matchingCandidates.filter(
      (candidate) => getDirectory(candidate.filePath) === originDir
    );
    if (localMatches.length > 0) {
      return {
        original: ref,
        targetNodeId: localMatches[0]!.id,
        confidence: LOCAL_SCOPE_CONFIDENCE,
        resolvedBy: 'framework',
      };
    }

    // 2. `.tfvars` file variable definitions targeting ancestor modules
    if (ref.filePath.endsWith('.tfvars') && targetQualifiedName.startsWith('var.')) {
      const ancestorMatch = locateNearestAncestorNode(matchingCandidates, originDir);
      if (ancestorMatch) {
        return {
          original: ref,
          targetNodeId: ancestorMatch.id,
          confidence: ANCESTOR_SCOPE_CONFIDENCE,
          resolvedBy: 'framework',
        };
      }
    }

    // 2b. Inherited provider configurations across module hierarchy
    if (targetQualifiedName.startsWith('provider.')) {
      const providerNamespaces = matchingCandidates.filter(
        (candidate) => candidate.kind === 'namespace'
      );
      const ancestorProvider = locateNearestAncestorNode(providerNamespaces, originDir);
      if (ancestorProvider) {
        return {
          original: ref,
          targetNodeId: ancestorProvider.id,
          confidence: ANCESTOR_SCOPE_CONFIDENCE,
          resolvedBy: 'framework',
        };
      }
      return null;
    }

    // Isolated cross-module direct references remain unlinked
    return null;
  },
};
