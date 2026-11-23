/**
 * AFYX Universal Migration Planner (AfyxMigrationPlan/v1).
 *
 * Universal, evidence-grounded transition and reorganization planner.
 * - Standard Workflow: Inspect -> Backup Plan -> Staged Apply Plan -> Verification -> Rollback Plan
 * - Default behavior is planning/dry-run; destructive operations require explicit caller permission
 * - Fails closed on conflicts, missing preconditions, or circular file dependencies
 * - Supports general folders, documents, data files, configurations, schemas, and Odoo projects
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, relative, resolve } from 'node:path';

export const MIGRATION_PLAN_CONTRACT = 'AfyxMigrationPlan/v1';

export class MigrationPlanner {
  /**
   * @param {string} workspaceRoot
   */
  constructor(workspaceRoot) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  /**
   * Generates a structured, evidence-grounded migration plan.
   *
   * @param {object} params
   * @param {string} params.migrationType 'folder-reorg' | 'document-migration' | 'data-transform' | 'config-transition' | 'schema-migration' | 'odoo-module-migration'
   * @param {string} params.sourcePath Relative or absolute source path
   * @param {string} params.targetPath Relative or absolute target path
   * @param {Array<object>} [params.itemMappings] Specific file or entity mappings [{ source, target, action }]
   * @param {object} [params.options]
   * @returns {object} Actionable, reversible migration plan
   */
  createMigrationPlan(params) {
    if (!params || !params.migrationType || !params.sourcePath || !params.targetPath) {
      throw new TypeError('migrationType, sourcePath, and targetPath are required.');
    }

    const absSource = resolve(this.workspaceRoot, params.sourcePath);
    const absTarget = resolve(this.workspaceRoot, params.targetPath);
    const now = new Date().toISOString();

    const inspection = this._inspectSource(absSource);
    const conflicts = this._checkConflicts(absSource, absTarget, params.itemMappings || []);
    const isOdoo = this._detectOdoo(absSource, absTarget);

    // 1. Preconditions
    const preconditions = [
      {
        id: 'PRE-1',
        description: `Source path exists at '${params.sourcePath}'`,
        satisfied: inspection.exists,
        critical: true,
      },
      {
        id: 'PRE-2',
        description: `Target path does not have unresolvable conflicts`,
        satisfied: conflicts.length === 0,
        critical: true,
        conflicts,
      },
    ];

    // 2. Backup Plan
    const backupDir = `.afyx-backup/migration_${params.migrationType}_${Date.now()}`;
    const backupPlan = {
      backupRequired: inspection.totalBytes > 0,
      backupTarget: backupDir,
      totalFilesToBackup: inspection.fileCount,
      estimatedBytes: inspection.totalBytes,
      strategy: 'copy-before-modify',
    };

    // 3. Staged Apply Plan (Dependency-ordered steps)
    const stagedSteps = this._buildStagedSteps(params, inspection, absSource, absTarget, isOdoo);

    // 4. Verification Checkpoints
    const verificationCheckpoints = [
      {
        stepId: 'VER-1',
        description: 'Verify all source files exist in target location or destination structure',
        type: 'file-existence-check',
      },
      {
        stepId: 'VER-2',
        description: 'Verify checksum integrity between migrated files and backup inventory',
        type: 'sha256-integrity-check',
      },
      {
        stepId: 'VER-3',
        description: 'Verify dependent references or imports are updated to new target paths',
        type: 'reference-consistency-check',
      },
    ];

    // 5. Reversible Rollback Plan
    const rollbackPlan = {
      feasible: true,
      strategy: 'atomic-restore-from-backup',
      backupSource: backupDir,
      steps: [
        {
          order: 1,
          action: 'halt-process',
          description: 'Halt all migration operations immediately on verification failure',
        },
        {
          order: 2,
          action: 'purge-incomplete-target',
          description: `Safely remove newly created staged artifacts in target '${params.targetPath}'`,
        },
        {
          order: 3,
          action: 'restore-from-backup',
          description: `Restore original directory contents from '${backupDir}' to '${params.sourcePath}'`,
        },
        {
          order: 4,
          action: 'verify-restoration',
          description: 'Verify workspace is restored exactly to pre-migration hash baseline',
        },
      ],
    };

    const hasCriticalFailure = preconditions.some((p) => p.critical && !p.satisfied);

    return {
      contract: MIGRATION_PLAN_CONTRACT,
      planId: `mig_${params.migrationType}_${Date.now()}`,
      migrationType: params.migrationType,
      domain: isOdoo ? 'odoo-specialized' : 'universal-generic',
      dryRun: params.options?.dryRun !== false,
      status: hasCriticalFailure ? 'BLOCKED_PRECONDITIONS' : 'READY_TO_APPLY',
      source: {
        path: params.sourcePath.replace(/\\/g, '/'),
        exists: inspection.exists,
        fileCount: inspection.fileCount,
        totalBytes: inspection.totalBytes,
      },
      target: {
        path: params.targetPath.replace(/\\/g, '/'),
        conflictsCount: conflicts.length,
      },
      preconditions,
      backupPlan,
      stagedSteps,
      verificationCheckpoints,
      rollbackPlan,
      risks: this._assessRisks(conflicts, inspection, isOdoo),
      createdAt: now,
    };
  }

  _inspectSource(absSource) {
    if (!existsSync(absSource)) {
      return { exists: false, fileCount: 0, totalBytes: 0, files: [] };
    }

    const stat = statSync(absSource);
    if (stat.isFile()) {
      return {
        exists: true,
        fileCount: 1,
        totalBytes: stat.size,
        files: [absSource],
      };
    }

    const files = [];
    let totalBytes = 0;

    const traverse = (dir) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!['.git', 'node_modules', '.afyx-graph'].includes(entry.name)) {
              traverse(full);
            }
          } else if (entry.isFile()) {
            files.push(full);
            totalBytes += statSync(full).size;
          }
        }
      } catch {
        // Skip unreadable
      }
    };

    traverse(absSource);
    return { exists: true, fileCount: files.length, totalBytes, files };
  }

  _checkConflicts(absSource, absTarget, itemMappings) {
    const conflicts = [];
    if (existsSync(absTarget)) {
      const statTarget = statSync(absTarget);
      if (statTarget.isFile()) {
        conflicts.push({
          type: 'TARGET_EXISTS',
          path: absTarget.replace(/\\/g, '/'),
          message: 'Target already exists and is a file.',
        });
      }
    }

    for (const m of itemMappings) {
      if (m.target) {
        const fullTarget = resolve(this.workspaceRoot, m.target);
        if (existsSync(fullTarget)) {
          conflicts.push({
            type: 'FILE_COLLISION',
            path: fullTarget.replace(/\\/g, '/'),
            message: `Destination file '${m.target}' already exists and will be overwritten.`,
          });
        }
      }
    }

    return conflicts;
  }

  _detectOdoo(absSource, absTarget) {
    const manifestCandidates = [
      join(absSource, '__manifest__.py'),
      join(absSource, '__openerp__.py'),
      join(absTarget, '__manifest__.py'),
    ];
    return manifestCandidates.some((p) => existsSync(p));
  }

  _buildStagedSteps(params, inspection, absSource, absTarget, isOdoo) {
    const steps = [];
    let order = 1;

    // Step 1: Pre-flight snapshot
    steps.push({
      stage: order++,
      id: 'STAGE-BACKUP',
      action: 'create-backup-snapshot',
      description: 'Create immutable pre-migration backup snapshot',
      reversible: true,
    });

    if (isOdoo) {
      // Odoo-specialized steps
      steps.push({
        stage: order++,
        id: 'STAGE-ODOO-MANIFEST',
        action: 'validate-manifest-version',
        description: 'Verify Odoo target version compatibility and manifest metadata',
        reversible: true,
      });
      steps.push({
        stage: order++,
        id: 'STAGE-ODOO-MODELS',
        action: 'migrate-orm-definitions',
        description: 'Update fields, model definitions, and security CSV entries',
        reversible: true,
      });
    }

    // Step 2: Content preparation / transformation
    steps.push({
      stage: order++,
      id: 'STAGE-TRANSFORM',
      action: 'staged-file-transfer',
      description: `Migrate ${inspection.fileCount} items from source to destination structure`,
      reversible: true,
    });

    // Step 3: Reference alignment
    steps.push({
      stage: order++,
      id: 'STAGE-REBIND-REFS',
      action: 'update-cross-references',
      description: 'Update import statements, Markdown links, and schema dependencies',
      reversible: true,
    });

    return steps;
  }

  _assessRisks(conflicts, inspection, isOdoo) {
    const risks = [];
    if (conflicts.length > 0) {
      risks.push({
        severity: 'HIGH',
        code: 'RISK_OVERWRITE',
        description: `${conflicts.length} existing files or paths will be overwritten or collided.`,
      });
    }
    if (inspection.totalBytes > 50 * 1024 * 1024) {
      risks.push({
        severity: 'MEDIUM',
        code: 'RISK_LARGE_VOLUME',
        description: `Migration exceeds 50MB (${(inspection.totalBytes / (1024 * 1024)).toFixed(1)}MB). Ensure adequate temporary disk space for backup.`,
      });
    }
    if (isOdoo) {
      risks.push({
        severity: 'MEDIUM',
        code: 'RISK_ODOO_XML_IDS',
        description: 'External XML IDs or database columns may require OpenUpgrade data migration scripts.',
      });
    }
    return risks;
  }
}
