import * as path from 'path';
import type { Node } from '../../types';
import { generateNodeId } from '../../extraction/node-id';
import type {
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
  FrameworkExtractionResult,
} from '../types';

/**
 * Standard Odoo model name conversion from XML ID:
 * `model_purchase_request` -> `purchase.request`
 */
export function odooModelNameFromId(modelId: string): string {
  if (modelId.startsWith('model_')) {
    return modelId.slice(6).replace(/_/g, '.');
  }
  return modelId;
}

/**
 * Extract clean string literal value from Python signature or attribute, e.g.:
 * `= 'purchase.request'` -> `'purchase.request'`
 * `= "purchase.request"` -> `'purchase.request'`
 */
export function extractStringLiteral(sig?: string): string | null {
  if (!sig) return null;
  const match = sig.match(/=\s*['"]([^'"]+)['"]/);
  return match ? match[1]! : null;
}

/**
 * Extract string array/tuple values from Python signature or attribute, e.g.:
 * `= ['mail.thread', 'mail.activity.mixin']` -> `['mail.thread', 'mail.activity.mixin']`
 */
export function extractStringListLiterals(sig?: string): string[] {
  if (!sig) return [];
  const single = extractStringLiteral(sig);
  if (single) return [single];
  const listMatches = sig.matchAll(/['"]([^'"]+)['"]/g);
  const result: string[] = [];
  for (const m of listMatches) {
    if (m[1]) result.push(m[1]);
  }
  return result;
}

interface OdooProjectRegistry {
  primaryModelToClass: Map<string, Node>;
  modelExtensions: Map<string, Node[]>;
  ambiguousModels: Set<string>;
  manifestsByModuleName: Map<string, Node>;
  groupsByQualifiedId: Map<string, Node>;
  groupsByLocalId: Map<string, Node>;
}

// Cached registry per resolution context to ensure fast O(1) resolution passes
const registryCache = new WeakMap<ResolutionContext, OdooProjectRegistry>();

/**
 * Derive Odoo technical module name from a file path.
 * e.g. `purchase_request_fixture/security/ir.model.access.csv` -> `purchase_request_fixture`
 */
export function getOdooModuleNameFromPath(
  normFilePath: string,
  manifestMap?: Map<string, Node>
): string | null {
  const parts = normFilePath.replace(/\\/g, '/').split('/');
  // Search from immediate parent directory up
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts[i]!;
    if (manifestMap && manifestMap.has(candidate)) {
      return candidate;
    }
  }
  // Heuristic if manifestMap not populated yet: segment before known standard subfolders
  for (let i = parts.length - 2; i >= 0; i--) {
    const seg = parts[i]!;
    if (seg === 'security' || seg === 'models' || seg === 'views' || seg === 'data' || seg === 'wizard') {
      if (i > 0) return parts[i - 1]!;
    }
  }
  return parts.length >= 2 ? parts[parts.length - 2]! : null;
}

function buildOdooRegistry(context: ResolutionContext): OdooProjectRegistry {
  const cached = registryCache.get(context);
  if (cached) return cached;

  const primaryModelToClass = new Map<string, Node>();
  const modelExtensions = new Map<string, Node[]>();
  const ambiguousModels = new Set<string>();
  const manifestsByModuleName = new Map<string, Node>();
  const groupsByQualifiedId = new Map<string, Node>();
  const groupsByLocalId = new Map<string, Node>();

  // 1. Index Manifests (kind: 'module', qualifiedName ends with '::manifest')
  const moduleNodes = context.getNodesByKind('module');
  for (const mod of moduleNodes) {
    if (mod.qualifiedName && mod.qualifiedName.endsWith('::manifest')) {
      const parts = mod.qualifiedName.replace(/::manifest$/, '').replace(/\\/g, '/').split('/');
      const moduleName = parts[parts.length - 1];
      if (moduleName) {
        manifestsByModuleName.set(moduleName, mod);
      }
    }
  }

  // 2. Index Security Groups (kind: 'constant', language: 'xml', signature starts with 'SecurityGroup:')
  const constantNodes = context.getNodesByKind('constant');
  for (const node of constantNodes) {
    if (node.language === 'xml' && node.signature && node.signature.startsWith('SecurityGroup:')) {
      const groupLocalId = node.name;
      const normPath = node.filePath.replace(/\\/g, '/');
      const moduleName = getOdooModuleNameFromPath(normPath, manifestsByModuleName);
      if (moduleName) {
        groupsByQualifiedId.set(`${moduleName}.${groupLocalId}`, node);
        groupsByLocalId.set(`${moduleName}::${groupLocalId}`, node);
      } else {
        groupsByLocalId.set(`::${groupLocalId}`, node);
      }
    }
  }

  // 3. Index Python Odoo Models (_name and _inherit properties)
  const nameProps = context.getNodesByName('_name');
  for (const prop of nameProps) {
    if (prop.kind !== 'property' || prop.language !== 'python') continue;
    const modelName = extractStringLiteral(prop.signature);
    if (!modelName) continue;

    const fileNodes = context.getNodesInFile(prop.filePath);
    // Find class enclosing this _name property
    const classNode = fileNodes.find(
      (n) => n.kind === 'class' && n.startLine <= prop.startLine && n.endLine >= prop.endLine
    );
    if (!classNode) continue;

    if (primaryModelToClass.has(modelName)) {
      const existing = primaryModelToClass.get(modelName)!;
      if (existing.id !== classNode.id) {
        ambiguousModels.add(modelName);
      }
    } else {
      primaryModelToClass.set(modelName, classNode);
    }
  }

  const inheritProps = context.getNodesByName('_inherit');
  for (const prop of inheritProps) {
    if (prop.kind !== 'property' || prop.language !== 'python') continue;
    const inheritedModels = extractStringListLiterals(prop.signature);
    if (inheritedModels.length === 0) continue;

    const fileNodes = context.getNodesInFile(prop.filePath);
    const classNode = fileNodes.find(
      (n) => n.kind === 'class' && n.startLine <= prop.startLine && n.endLine >= prop.endLine
    );
    if (!classNode) continue;

    // Check if class also defines an explicit _name
    const hasOwnName = fileNodes.some(
      (n) => n.kind === 'property' && n.name === '_name' && n.startLine <= classNode.endLine && n.startLine >= classNode.startLine
    );

    // If it has no own _name (or _name is identical), it is an in-place model extension
    if (!hasOwnName) {
      for (const mName of inheritedModels) {
        let exts = modelExtensions.get(mName);
        if (!exts) {
          exts = [];
          modelExtensions.set(mName, exts);
        }
        if (!exts.some((e) => e.id === classNode.id)) {
          exts.push(classNode);
        }
      }
    }
  }

  const registry: OdooProjectRegistry = {
    primaryModelToClass,
    modelExtensions,
    ambiguousModels,
    manifestsByModuleName,
    groupsByQualifiedId,
    groupsByLocalId,
  };

  registryCache.set(context, registry);
  return registry;
}

/**
 * Native Odoo Framework Resolver for Cross-Asset Relationship Resolution
 */
export const odooResolver: FrameworkResolver = {
  name: 'odoo',
  languages: ['python', 'xml', 'csv'],

  /**
   * Pre-filter claim: tells resolveOne to allow these reference patterns past
   * symbol-existence checks so they can be resolved by Odoo framework logic.
   */
  claimsReference(name: string): boolean {
    if (name.startsWith('model_')) return true;
    if (name.includes('.')) return true; // Dotted Odoo models (purchase.request) or XML IDs (purchase.group_user)
    if (name.endsWith('.xml') || name.endsWith('.csv')) return true; // Data files in manifest
    if (name.includes('/')) return true; // Relative paths in data
    // Technical module dependency names (e.g. 'purchase', 'mail', 'account')
    if (/^[a-z][a-z0-9_]*$/.test(name)) return true;
    return false;
  },

  detect(context: ResolutionContext): boolean {
    const files = context.getAllFiles();
    return files.some(
      (f) =>
        f.endsWith('__manifest__.py') ||
        f.endsWith('__openerp__.py') ||
        f.endsWith('ir.model.access.csv') ||
        f.includes('odoo')
    );
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const normPath = filePath.replace(/\\/g, '/');

    // Only inspect Python files that are not manifests
    if (!normPath.endsWith('.py') || normPath.endsWith('__manifest__.py') || normPath.endsWith('__openerp__.py')) {
      return { nodes, references };
    }

    // Fast check for Odoo class definitions
    if (!content.includes('class ') || (!content.includes('_name') && !content.includes('_inherit'))) {
      return { nodes, references };
    }

    const lines = content.split('\n');
    let currentClass: { name: string; line: number; nodeId: string } | null = null;
    let currentIndent = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineNum = lineIdx + 1;
      const rawLine = lines[lineIdx]!;
      const trimmed = rawLine.trim();

      // Skip comment lines
      if (trimmed.startsWith('#')) continue;

      // Match class declaration
      const classMatch = rawLine.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?:/);
      if (classMatch) {
        const indentStr = classMatch[1] || '';
        const className = classMatch[2]!;
        currentIndent = indentStr.length;
        const nodeId = generateNodeId(normPath, 'class', className, lineNum);
        currentClass = { name: className, line: lineNum, nodeId };
        continue;
      }

      if (!currentClass) continue;

      // Check indentation to see if still inside class
      if (trimmed.length > 0) {
        const lineIndent = rawLine.search(/\S/);
        if (lineIndent !== -1 && lineIndent <= currentIndent) {
          currentClass = null;
          continue;
        }
      }

      // Check _inherit assignment: _inherit = 'purchase.order' or _inherit = ['mail.thread']
      const inheritMatch = trimmed.match(/^_inherit\s*=\s*(.+)$/);
      if (inheritMatch) {
        const inheritVal = inheritMatch[1]!;
        const inheritedModels = extractStringListLiterals(`= ${inheritVal}`);
        for (const model of inheritedModels) {
          references.push({
            fromNodeId: currentClass.nodeId,
            referenceName: model,
            referenceKind: 'extends',
            line: lineNum,
            column: rawLine.indexOf('_inherit') + 1,
            filePath: normPath,
            language: 'python',
          });
        }
      }

      // Check _inherits assignment (delegation inheritance): _inherits = {'res.partner': 'partner_id'}
      const inheritsMatch = trimmed.match(/^_inherits\s*=\s*\{([^}]+)\}/);
      if (inheritsMatch) {
        const dictBody = inheritsMatch[1]!;
        // Extract dictionary keys (delegated models)
        const keyMatches = dictBody.matchAll(/['"]([^'"]+)['"]\s*:/g);
        for (const km of keyMatches) {
          if (km[1]) {
            references.push({
              fromNodeId: currentClass.nodeId,
              referenceName: km[1],
              referenceKind: 'references',
              line: lineNum,
              column: rawLine.indexOf('_inherits') + 1,
              filePath: normPath,
              language: 'python',
            });
          }
        }
      }
    }

    return { nodes, references };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    const registry = buildOdooRegistry(context);
    const normRefPath = ref.filePath.replace(/\\/g, '/');

    // -------------------------------------------------------------------------
    // Case 1: Manifest references (__manifest__.py / __openerp__.py)
    // -------------------------------------------------------------------------
    if (normRefPath.endsWith('__manifest__.py') || normRefPath.endsWith('__openerp__.py')) {
      const moduleDir = path.dirname(normRefPath);

      // 1A. Data file references (referenceKind: 'references')
      if (ref.referenceKind === 'references') {
        const rawTarget = ref.referenceName.replace(/\\/g, '/').trim();
        // Strict security & path-safety guard: refuse path traversal or absolute roots
        if (rawTarget.startsWith('/') || rawTarget.includes('..') || /^[a-zA-Z]:/.test(rawTarget)) {
          return null;
        }
        const targetPath = `${moduleDir}/${rawTarget}`.replace(/\/+/g, '/');
        const fileNodes = context.getNodesInFile(targetPath);
        const fileNode = fileNodes.find((n) => n.kind === 'file');
        if (fileNode) {
          return {
            original: ref,
            targetNodeId: fileNode.id,
            confidence: 1.0,
            resolvedBy: 'framework',
            edgeKind: 'references',
            metadata: {
              relation: 'manifest_data_file',
              declaredPath: rawTarget,
            },
          };
        }
        // Manifest data file not found in local workspace (leave unresolved)
        return null;
      }

      // 1B. Module dependency references ('depends', referenceKind: 'imports')
      if (ref.referenceKind === 'imports') {
        const depModuleName = ref.referenceName.trim();
        const targetManifest = registry.manifestsByModuleName.get(depModuleName);
        if (targetManifest) {
          return {
            original: ref,
            targetNodeId: targetManifest.id,
            confidence: 1.0,
            resolvedBy: 'framework',
            edgeKind: 'imports',
            metadata: {
              relation: 'module_dependency',
              dependencyModule: depModuleName,
            },
          };
        }
        // External dependency not in repository (leave unresolved without fabricating nodes)
        return null;
      }
    }

    // -------------------------------------------------------------------------
    // Case 2: Model References (ACL CSV, ir.rule XML, or Python _inherit)
    // -------------------------------------------------------------------------
    let candidateModelName: string | null = null;
    if (ref.referenceName.startsWith('model_')) {
      candidateModelName = odooModelNameFromId(ref.referenceName);
    } else if (registry.primaryModelToClass.has(ref.referenceName)) {
      candidateModelName = ref.referenceName;
    }

    if (candidateModelName) {
      // Disambiguation check
      if (registry.ambiguousModels.has(candidateModelName)) {
        const callerModuleName = getOdooModuleNameFromPath(normRefPath, registry.manifestsByModuleName);
        const allNameProps = context.getNodesByName('_name');
        for (const p of allNameProps) {
          if (extractStringLiteral(p.signature) !== candidateModelName) continue;
          const pMod = getOdooModuleNameFromPath(p.filePath, registry.manifestsByModuleName);
          if (pMod && callerModuleName && pMod === callerModuleName) {
            const fileNodes = context.getNodesInFile(p.filePath);
            const cls = fileNodes.find(
              (n) => n.kind === 'class' && n.startLine <= p.startLine && n.endLine >= p.endLine
            );
            if (cls) {
              return {
                original: ref,
                targetNodeId: cls.id,
                confidence: 0.9,
                resolvedBy: 'framework',
                edgeKind: ref.referenceKind === 'extends' ? 'extends' : 'references',
                metadata: {
                  relation: ref.referenceKind === 'extends' ? 'model_inheritance' : 'model_reference',
                  odooModel: candidateModelName,
                },
              };
            }
          }
        }
        // Irreconcilably ambiguous across modules: do not guess
        return null;
      }

      const targetClass = registry.primaryModelToClass.get(candidateModelName);
      if (targetClass) {
        // Prevent self-referencing loops
        if (targetClass.id === ref.fromNodeId) {
          return null;
        }
        return {
          original: ref,
          targetNodeId: targetClass.id,
          confidence: 0.95,
          resolvedBy: 'framework',
          edgeKind: ref.referenceKind === 'extends' ? 'extends' : 'references',
          metadata: {
            relation: ref.referenceKind === 'extends' ? 'model_inheritance' : 'model_reference',
            odooModel: candidateModelName,
          },
        };
      }

      // Check if candidate model exists as direct underscore name without dots
      if (ref.referenceName.startsWith('model_')) {
        const directUnderscoreName = ref.referenceName.slice(6);
        const directClass = registry.primaryModelToClass.get(directUnderscoreName);
        if (directClass && directClass.id !== ref.fromNodeId) {
          return {
            original: ref,
            targetNodeId: directClass.id,
            confidence: 0.95,
            resolvedBy: 'framework',
            edgeKind: ref.referenceKind === 'extends' ? 'extends' : 'references',
            metadata: {
              relation: 'model_reference',
              odooModel: directUnderscoreName,
            },
          };
        }
      }

      // Model declaration missing from repository (leave unresolved)
      return null;
    }

    // -------------------------------------------------------------------------
    // Case 3: Security Group References (ACL CSV, ir.rule groups, implied_ids)
    // -------------------------------------------------------------------------
    const isSecurityRef = ref.language === 'csv' || ref.language === 'xml';
    if (isSecurityRef) {
      // 3A. Explicitly qualified XML ID: 'purchase.group_purchase_user'
      if (ref.referenceName.includes('.')) {
        const groupNode = registry.groupsByQualifiedId.get(ref.referenceName);
        if (groupNode) {
          return {
            original: ref,
            targetNodeId: groupNode.id,
            confidence: 0.95,
            resolvedBy: 'framework',
            edgeKind: 'references',
            metadata: {
              relation: 'security_group_binding',
              xmlId: ref.referenceName,
            },
          };
        }
        // External qualified group (e.g. 'base.group_user') not in repository
        return null;
      }

      // 3B. Module-local XML ID: 'group_purchase_user'
      const callerModuleName = getOdooModuleNameFromPath(normRefPath, registry.manifestsByModuleName);
      const localKey = callerModuleName ? `${callerModuleName}::${ref.referenceName}` : `::${ref.referenceName}`;
      const localGroup = registry.groupsByLocalId.get(localKey);
      if (localGroup) {
        return {
          original: ref,
          targetNodeId: localGroup.id,
          confidence: 0.95,
          resolvedBy: 'framework',
          edgeKind: 'references',
          metadata: {
            relation: 'security_group_binding',
            xmlId: ref.referenceName,
          },
        };
      }

      // 3C. Also check if any group across workspace matches local ID if caller module is unknown
      for (const [key, node] of registry.groupsByLocalId.entries()) {
        if (key.endsWith(`::${ref.referenceName}`)) {
          return {
            original: ref,
            targetNodeId: node.id,
            confidence: 0.85,
            resolvedBy: 'framework',
            edgeKind: 'references',
            metadata: {
              relation: 'security_group_binding',
              xmlId: ref.referenceName,
            },
          };
        }
      }
    }

    // -------------------------------------------------------------------------
    // Case 4: Delegation inheritance (_inherits) in Python
    // -------------------------------------------------------------------------
    if (ref.language === 'python' && ref.referenceKind === 'references') {
      const delegatedClass = registry.primaryModelToClass.get(ref.referenceName);
      if (delegatedClass && delegatedClass.id !== ref.fromNodeId) {
        return {
          original: ref,
          targetNodeId: delegatedClass.id,
          confidence: 0.95,
          resolvedBy: 'framework',
          edgeKind: 'references',
          metadata: {
            relation: 'delegation_inheritance',
            delegatedModel: ref.referenceName,
          },
        };
      }
    }

    return null;
  },
};
