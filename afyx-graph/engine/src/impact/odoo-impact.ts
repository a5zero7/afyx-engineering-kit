import type AfyxGraph from '../index';
import type { Node } from '../types';
import { isTestPath } from '../search/test-paths';
import { getOdooModuleNameFromPath, extractStringLiteral } from '../resolution/frameworks/odoo';

export interface OdooImpactedModel {
  name: string;
  relationship:
    | 'primary_declaration'
    | 'classical_inheritance'
    | 'in_place_extension'
    | 'delegation'
    | 'governed_by_acl'
    | 'restricted_by_rule';
  direction: 'direct' | 'transitive';
  hopCount: number;
  filePath: string;
  sourceFile: string;
}

export interface OdooImpactedSecurityAsset {
  ruleId: string;
  assetType: 'acl_grant' | 'record_rule' | 'security_group';
  semantics: string;
  direction: 'direct' | 'transitive';
  hopCount: number;
  filePath: string;
  targetModel?: string;
  targetGroup?: string;
  sourceFile: string;
}

export interface OdooImpactedModule {
  moduleName: string;
  manifestPath: string;
  direction: 'direct' | 'transitive';
  hopCount: number;
  reason: 'contains_changed_file' | 'depends_on_changed_module' | 'contains_affected_model';
}

export interface OdooImpactResult {
  isOdooProject: boolean;
  affectedModels: OdooImpactedModel[];
  affectedSecurityAssets: OdooImpactedSecurityAsset[];
  affectedModules: OdooImpactedModule[];
  affectedTests: string[];
  limitations: string[];
  disclaimer: string;
}

/**
 * Deterministic Odoo-aware impact analysis.
 * Traces models, security rules, module dependencies, and candidate tests
 * based on verified Graph relationships.
 */
export function computeOdooImpact(
  cg: AfyxGraph,
  changedFiles: string[],
  options: { maxDepth?: number } = {}
): OdooImpactResult {
  const maxDepth = options.maxDepth ?? 5;
  const limitations = new Set<string>();

  // 1. Identify all Odoo manifests in graph
  const allModules = cg.getNodesByKind('module');
  const manifestNodes = allModules.filter((n) => n.qualifiedName?.endsWith('::manifest'));
  const isOdoo =
    manifestNodes.length > 0 ||
    cg.getFiles().some((f) => f.path.endsWith('__manifest__.py') || f.path.endsWith('ir.model.access.csv'));

  if (!isOdoo) {
    return {
      isOdooProject: false,
      affectedModels: [],
      affectedSecurityAssets: [],
      affectedModules: [],
      affectedTests: [],
      limitations: [],
      disclaimer: 'Not an Odoo project.',
    };
  }

  const moduleNameToManifest = new Map<string, Node>();
  for (const m of manifestNodes) {
    const modName = getOdooModuleNameFromPath(m.filePath);
    if (modName) {
      moduleNameToManifest.set(modName, m);
    }
  }

  const modelsMap = new Map<string, OdooImpactedModel>();
  const securityAssetsMap = new Map<string, OdooImpactedSecurityAsset>();
  const modulesMap = new Map<string, OdooImpactedModule>();
  const candidateTests = new Set<string>();

  // Helper to add affected module
  const addAffectedModule = (
    moduleName: string,
    direction: 'direct' | 'transitive',
    hopCount: number,
    reason: OdooImpactedModule['reason']
  ) => {
    const existing = modulesMap.get(moduleName);
    if (!existing || existing.hopCount > hopCount) {
      const manifest = moduleNameToManifest.get(moduleName);
      modulesMap.set(moduleName, {
        moduleName,
        manifestPath: manifest?.filePath ?? `${moduleName}/__manifest__.py`,
        direction,
        hopCount,
        reason,
      });
    }
  };

  // 2. Process each changed file
  for (const rawFile of changedFiles) {
    const normPath = rawFile.replace(/\\/g, '/');
    const owningModuleName = getOdooModuleNameFromPath(normPath, moduleNameToManifest);

    if (owningModuleName) {
      addAffectedModule(owningModuleName, 'direct', 0, 'contains_changed_file');
    }

    const fileNodes = cg.getNodesInFile(normPath);
    if (fileNodes.length === 0 && !cg.getFiles().some((f) => f.path === normPath)) {
      limitations.add('CHANGED_FILE_NOT_INDEXED');
    }

    // --- Scenario A: Python Model File Changes ---
    if (normPath.endsWith('.py') && !normPath.endsWith('__manifest__.py') && !normPath.endsWith('__openerp__.py')) {
      const classesInFile = fileNodes.filter((n) => n.kind === 'class');
      for (const cls of classesInFile) {
        // Look for model name
        const childProps = cg.getOutgoingEdges(cls.id).filter((e) => e.kind === 'contains');
        const childNodes = childProps.map((e) => cg.getNode(e.target)).filter((n): n is Node => !!n);
        const nameProp = childNodes.find((n) => n.kind === 'property' && n.name === '_name');
        const inheritProp = childNodes.find((n) => n.kind === 'property' && n.name === '_inherit');

        let declaredModelName = nameProp ? extractStringLiteral(nameProp.signature) : null;
        const inheritedModelName = inheritProp ? extractStringLiteral(inheritProp.signature) : null;

        if (!declaredModelName && inheritedModelName) {
          // In-place extension
          declaredModelName = inheritedModelName;
        }

        if (declaredModelName) {
          const modelKey = `${declaredModelName}:${normPath}:primary`;
          modelsMap.set(modelKey, {
            name: declaredModelName,
            relationship: 'primary_declaration',
            direction: 'direct',
            hopCount: 0,
            filePath: normPath,
            sourceFile: normPath,
          });

          // Trace inheritance: who extends this model? (incoming 'extends' edges)
          const incomingExtends = cg.getIncomingEdges(cls.id).filter((e) => e.kind === 'extends');
          for (const edge of incomingExtends) {
            const extenderClass = cg.getNode(edge.source);
            if (extenderClass) {
              const extFileNodes = cg.getNodesInFile(extenderClass.filePath);
              const extNameProp = extFileNodes.find(
                (n) => n.kind === 'property' && n.name === '_name' && n.startLine >= extenderClass.startLine && n.startLine <= extenderClass.endLine
              );
              const extModelName = extNameProp ? extractStringLiteral(extNameProp.signature) : declaredModelName;
              const isClassical = extNameProp !== undefined && extModelName !== declaredModelName;

              const relType = isClassical ? 'classical_inheritance' : 'in_place_extension';
              const extKey = `${extModelName || declaredModelName}:${extenderClass.filePath}:${relType}`;
              modelsMap.set(extKey, {
                name: extModelName || declaredModelName,
                relationship: relType,
                direction: 'direct',
                hopCount: 1,
                filePath: extenderClass.filePath,
                sourceFile: normPath,
              });

              const extMod = getOdooModuleNameFromPath(extenderClass.filePath, moduleNameToManifest);
              if (extMod) addAffectedModule(extMod, 'transitive', 1, 'contains_affected_model');
            }
          }

          // Trace referencing security assets (incoming 'references' edges)
          const incomingRefs = cg.getIncomingEdges(cls.id).filter((e) => e.kind === 'references');
          for (const edge of incomingRefs) {
            const secNode = cg.getNode(edge.source);
            if (secNode && secNode.kind === 'constant') {
              const isCsv = secNode.filePath.endsWith('.csv');
              const isXml = secNode.filePath.endsWith('.xml');
              if (isCsv) {
                securityAssetsMap.set(`${secNode.name}:${secNode.filePath}`, {
                  ruleId: secNode.name,
                  assetType: 'acl_grant',
                  semantics: 'Model-level Access Grant (ir.model.access)',
                  direction: 'direct',
                  hopCount: 1,
                  filePath: secNode.filePath,
                  targetModel: declaredModelName,
                  sourceFile: normPath,
                });
              } else if (isXml) {
                securityAssetsMap.set(`${secNode.name}:${secNode.filePath}`, {
                  ruleId: secNode.name,
                  assetType: 'record_rule',
                  semantics: 'Row-level Domain Restriction (ir.rule)',
                  direction: 'direct',
                  hopCount: 1,
                  filePath: secNode.filePath,
                  targetModel: declaredModelName,
                  sourceFile: normPath,
                });
              }
            }
          }
        }
      }
    }

    // --- Scenario B: ACL CSV Changes (ir.model.access.csv) ---
    if (normPath.includes('ir.model.access') || normPath.endsWith('.csv')) {
      const aclNodes = fileNodes.filter((n) => n.kind === 'constant');
      for (const acl of aclNodes) {
        securityAssetsMap.set(`${acl.name}:${normPath}`, {
          ruleId: acl.name,
          assetType: 'acl_grant',
          semantics: 'Model-level Access Grant (ir.model.access)',
          direction: 'direct',
          hopCount: 0,
          filePath: normPath,
          sourceFile: normPath,
        });

        // Trace governed model and bound group via outgoing 'references'
        const outgoing = cg.getOutgoingEdges(acl.id).filter((e) => e.kind === 'references');
        for (const edge of outgoing) {
          const target = cg.getNode(edge.target);
          if (!target) continue;
          if (target.kind === 'class') {
            const mProps = cg.getNodesInFile(target.filePath).filter((n) => n.kind === 'property' && n.name === '_name');
            const targetModelName = mProps.length > 0 ? extractStringLiteral(mProps[0]?.signature) : target.name;
            if (targetModelName) {
              modelsMap.set(`${targetModelName}:${target.filePath}:governed`, {
                name: targetModelName,
                relationship: 'governed_by_acl',
                direction: 'direct',
                hopCount: 1,
                filePath: target.filePath,
                sourceFile: normPath,
              });
            }
          } else if (target.kind === 'constant') {
            securityAssetsMap.set(`${target.name}:${target.filePath}`, {
              ruleId: target.name,
              assetType: 'security_group',
              semantics: 'Security Group Binding (res.groups)',
              direction: 'direct',
              hopCount: 1,
              filePath: target.filePath,
              sourceFile: normPath,
            });
          }
        }
      }
    }

    // --- Scenario C: Security XML Changes (security/*.xml) ---
    if (normPath.endsWith('.xml')) {
      const xmlConstants = fileNodes.filter((n) => n.kind === 'constant');
      for (const node of xmlConstants) {
        const isRule = node.signature?.startsWith('RecordRule:');
        const isGroup = node.signature?.startsWith('SecurityGroup:');

        if (isRule) {
          securityAssetsMap.set(`${node.name}:${normPath}`, {
            ruleId: node.name,
            assetType: 'record_rule',
            semantics: 'Row-level Domain Restriction (ir.rule)',
            direction: 'direct',
            hopCount: 0,
            filePath: normPath,
            sourceFile: normPath,
          });

          // Trace restricted model and groups
          const outgoing = cg.getOutgoingEdges(node.id).filter((e) => e.kind === 'references');
          for (const edge of outgoing) {
            const target = cg.getNode(edge.target);
            if (!target) continue;
            if (target.kind === 'class') {
              const mProps = cg.getNodesInFile(target.filePath).filter((n) => n.kind === 'property' && n.name === '_name');
              const targetModelName = mProps.length > 0 ? extractStringLiteral(mProps[0]?.signature) : target.name;
              if (targetModelName) {
                modelsMap.set(`${targetModelName}:${target.filePath}:restricted`, {
                  name: targetModelName,
                  relationship: 'restricted_by_rule',
                  direction: 'direct',
                  hopCount: 1,
                  filePath: target.filePath,
                  sourceFile: normPath,
                });
              }
            } else if (target.kind === 'constant') {
              securityAssetsMap.set(`${target.name}:${target.filePath}`, {
                ruleId: target.name,
                assetType: 'security_group',
                semantics: 'Security Group Binding (res.groups)',
                direction: 'direct',
                hopCount: 1,
                filePath: target.filePath,
                sourceFile: normPath,
              });
            }
          }
        } else if (isGroup) {
          securityAssetsMap.set(`${node.name}:${normPath}`, {
            ruleId: node.name,
            assetType: 'security_group',
            semantics: 'Security Group Definition (res.groups)',
            direction: 'direct',
            hopCount: 0,
            filePath: normPath,
            sourceFile: normPath,
          });

          // Trace implied groups inheriting this group (incoming 'references' edges)
          const incomingImplied = cg.getIncomingEdges(node.id).filter((e) => e.kind === 'references');
          for (const edge of incomingImplied) {
            const parentGroup = cg.getNode(edge.source);
            if (parentGroup && parentGroup.kind === 'constant') {
              securityAssetsMap.set(`${parentGroup.name}:${parentGroup.filePath}`, {
                ruleId: parentGroup.name,
                assetType: 'security_group',
                semantics: 'Inherits Implied Security Group',
                direction: 'transitive',
                hopCount: 1,
                filePath: parentGroup.filePath,
                sourceFile: normPath,
              });
            }
          }
        }
      }
    }
  }

  // 3. Module Dependency Traversal: Direct & Transitive Consumers (cycle-safe)
  const initialModules = [...modulesMap.keys()];
  for (const modName of initialModules) {
    const modNode = moduleNameToManifest.get(modName);
    if (!modNode) continue;

    const queue: Array<{ node: Node; depth: number }> = [{ node: modNode, depth: 0 }];
    const visited = new Set<string>([modNode.id]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const incomingImports = cg.getIncomingEdges(current.node.id).filter((e) => e.kind === 'imports');
      for (const edge of incomingImports) {
        if (visited.has(edge.source)) continue;
        visited.add(edge.source);

        const dependentModNode = cg.getNode(edge.source);
        if (dependentModNode && dependentModNode.kind === 'module') {
          const depModuleName = getOdooModuleNameFromPath(dependentModNode.filePath, moduleNameToManifest);
          if (depModuleName) {
            addAffectedModule(
              depModuleName,
              current.depth === 0 ? 'direct' : 'transitive',
              current.depth + 1,
              'depends_on_changed_module'
            );
            queue.push({ node: dependentModNode, depth: current.depth + 1 });
          }
        }
      }
    }
  }

  // 4. Candidate Affected Tests Discovery
  const allIndexedFiles = cg.getFiles().map((f) => f.path);
  for (const file of allIndexedFiles) {
    if (!isTestPath(file)) continue;

    // Check if test lives in an affected module
    const testModule = getOdooModuleNameFromPath(file, moduleNameToManifest);
    if (testModule && modulesMap.has(testModule)) {
      candidateTests.add(file);
      continue;
    }

    // Check if test directly depends on any changed file
    const dependents = cg.getFileDependents(file);
    if (changedFiles.some((cf) => dependents.includes(cf))) {
      candidateTests.add(file);
    }
  }

  // Check index health limitations
  const diskChanges = cg.getChangedFiles();
  if (diskChanges.modified.length > 0 || diskChanges.added.length > 0 || diskChanges.removed.length > 0) {
    limitations.add('INDEX_FRESHNESS_STALE');
  }

  return {
    isOdooProject: true,
    affectedModels: [...modelsMap.values()],
    affectedSecurityAssets: [...securityAssetsMap.values()],
    affectedModules: [...modulesMap.values()],
    affectedTests: [...candidateTests].sort(),
    limitations: [...limitations].sort(),
    disclaimer:
      'Static graph relationships identify structurally bound assets only; effective runtime access depends on active user groups and evaluated record domains at runtime in Odoo.',
  };
}
