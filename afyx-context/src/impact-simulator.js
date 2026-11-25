/**
 * AFYX Universal Impact Simulator (AFYX-116 / AfyxImpactSimulation/v1).
 *
 * Universal, read-only dependency and blast-radius impact analysis.
 * - Simulates upstream dependencies (what a file/symbol depends on)
 * - Simulates downstream dependents (what depends on a file/symbol)
 * - Computes direct and indirect blast radius, dependency depth, and risk levels
 * - Connects to AFYX Graph if available; provides a fast deterministic fallback
 *   for ordinary documents, configurations, CSV, and non-indexed folders.
 * - Strictly cycle-safe (visited set) with bounded exploration.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, relative, resolve } from 'node:path';

export const IMPACT_SIMULATION_CONTRACT = 'AfyxImpactSimulation/v1';

export class ImpactSimulator {
  /**
   * @param {string} workspaceRoot
   * @param {object} [options]
   * @param {object} [options.graphEngine] Optional initialized AfyxGraph instance
   */
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.graph = options.graphEngine || null;
  }

  /**
   * Simulates the impact of changing a target file or symbol.
   *
   * @param {string} targetPath Relative or absolute target path
   * @param {object} [options]
   * @param {number} [options.maxDepth=3] Maximum traversal depth
   * @param {boolean} [options.includeUpstream=true] Include upstream dependencies
   * @param {boolean} [options.includeDownstream=true] Include downstream dependents
   * @returns {object} Structured impact simulation result
   */
  simulate(targetPath, options = {}) {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new TypeError('targetPath must be a non-empty string.');
    }
    if (options.peerProjectPaths !== undefined) {
      if (!Array.isArray(options.peerProjectPaths) || typeof options.symbol !== 'string' ||
          typeof this.graph?.getCrossRepoContractImpact !== 'function') {
        return { contract: IMPACT_SIMULATION_CONTRACT, status: 'NOT_AVAILABLE', reason: 'PEER_GRAPH_REQUIRED' };
      }
      return this.graph.getCrossRepoContractImpact(targetPath, options.symbol, options.peerProjectPaths, options.maxDepth);
    }

    const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 3, 10));
    const absTarget = resolve(this.workspaceRoot, targetPath);
    const relTarget = relative(this.workspaceRoot, absTarget).replace(/\\/g, '/');
    const now = new Date().toISOString();

    if (!existsSync(absTarget)) {
      return {
        contract: IMPACT_SIMULATION_CONTRACT,
        target: relTarget,
        status: 'TARGET_NOT_FOUND',
        upstream: [],
        downstream: [],
        blastRadius: { totalFiles: 0, directCount: 0, indirectCount: 0, maxDepth: 0 },
        riskLevel: 'LOW',
        confidence: 1.0,
        unresolved: [],
        evidence: [],
        timestamp: now,
      };
    }

    if (this.graph) {
      return this._simulateWithGraph(relTarget, absTarget, maxDepth, options);
    } else {
      return this._simulateFallback(relTarget, absTarget, maxDepth, options);
    }
  }

  _simulateWithGraph(relTarget, absTarget, maxDepth, options) {
    try {
      const fileNodes = this.graph.getNodesInFile(relTarget);
      const targetNodeIds = fileNodes.map((n) => n.id);

      // 1. Downstream (nodes that depend on target)
      const downstreamMap = new Map();
      const visitedDownstream = new Set(targetNodeIds);
      let currentQueue = [...targetNodeIds];
      let depth = 1;

      while (currentQueue.length > 0 && depth <= maxDepth) {
        const nextQueue = [];
        const incomingEdges = this.graph.getIncomingEdgesTo(currentQueue);

        for (const edge of incomingEdges) {
          if (!visitedDownstream.has(edge.source)) {
            visitedDownstream.add(edge.source);
            const sourceNode = this.graph.getNodeById?.(edge.source) || { filePath: 'unknown' };
            const sourceFile = sourceNode.filePath || 'unknown';

            if (sourceFile !== relTarget && !downstreamMap.has(sourceFile)) {
              downstreamMap.set(sourceFile, {
                file: sourceFile,
                distance: depth,
                kind: edge.kind,
                direct: depth === 1,
              });
            }
            nextQueue.push(edge.source);
          }
        }
        currentQueue = nextQueue;
        depth++;
      }

      // 2. Upstream (nodes that target depends on)
      const upstreamMap = new Map();
      const visitedUpstream = new Set(targetNodeIds);
      currentQueue = [...targetNodeIds];
      depth = 1;

      while (currentQueue.length > 0 && depth <= maxDepth) {
        const nextQueue = [];
        const outgoingEdges = this.graph.getOutgoingEdgesFrom(currentQueue);

        for (const edge of outgoingEdges) {
          if (!visitedUpstream.has(edge.target)) {
            visitedUpstream.add(edge.target);
            const targetNode = this.graph.getNodeById?.(edge.target) || { filePath: 'unknown' };
            const targetFile = targetNode.filePath || 'unknown';

            if (targetFile !== relTarget && !upstreamMap.has(targetFile)) {
              upstreamMap.set(targetFile, {
                file: targetFile,
                distance: depth,
                kind: edge.kind,
                direct: depth === 1,
              });
            }
            nextQueue.push(edge.target);
          }
        }
        currentQueue = nextQueue;
        depth++;
      }

      const downstream = [...downstreamMap.values()];
      const upstream = [...upstreamMap.values()];
      const directCount = downstream.filter((d) => d.direct).length;
      const indirectCount = downstream.filter((d) => !d.direct).length;

      const riskLevel = directCount > 5 || indirectCount > 10 ? 'HIGH' : directCount > 0 ? 'MEDIUM' : 'LOW';

      return {
        contract: IMPACT_SIMULATION_CONTRACT,
        target: relTarget,
        status: 'ANALYZED_GRAPH',
        upstream,
        downstream,
        blastRadius: {
          totalFiles: downstream.length,
          directCount,
          indirectCount,
          maxObservedDepth: downstream.reduce((max, d) => Math.max(max, d.distance), 0),
        },
        riskLevel,
        confidence: 0.95,
        unresolved: [],
        evidence: [
          {
            type: 'graph-traversal',
            description: `Traversed ${targetNodeIds.length} nodes in ${relTarget}`,
            edgeCount: incomingEdges?.length || 0,
          },
        ],
        timestamp: new Date().toISOString(),
      };
    } catch {
      return this._simulateFallback(relTarget, absTarget, maxDepth, options);
    }
  }

  _simulateFallback(relTarget, absTarget, maxDepth, options) {
    const ext = extname(absTarget).toLowerCase();
    const targetBase = basename(absTarget);
    const targetNameNoExt = basename(absTarget, ext);

    const allFiles = this._scanWorkspaceFiles();
    const downstream = [];
    const upstream = [];
    const unresolved = [];

    // Scan target file content to find what it references (Upstream)
    try {
      const targetContent = readFileSync(absTarget, 'utf8');
      const lines = targetContent.split(/\r?\n/);

      for (const line of lines) {
        // Markdown links: [text](path/to/file.md) or ![img](path)
        const mdLinkMatches = line.matchAll(/\[(?:[^\]]*)\]\(([^)]+)\)/g);
        for (const m of mdLinkMatches) {
          const rawLink = m[1].split('#')[0].split('?')[0];
          if (!rawLink.startsWith('http://') && !rawLink.startsWith('https://') && !rawLink.startsWith('mailto:')) {
            const resolvedPath = relative(this.workspaceRoot, resolve(dirname(absTarget), rawLink)).replace(/\\/g, '/');
            if (!upstream.some((u) => u.file === resolvedPath)) {
              upstream.push({ file: resolvedPath, distance: 1, kind: 'references', direct: true });
            }
          }
        }

        // Import / Require / Config references
        const importMatches = line.matchAll(/(?:import|require|from)\s*['"]([^'"]+)['"]/g);
        for (const m of importMatches) {
          const mod = m[1];
          if (mod.startsWith('.')) {
            const resolvedPath = relative(this.workspaceRoot, resolve(dirname(absTarget), mod)).replace(/\\/g, '/');
            if (!upstream.some((u) => u.file === resolvedPath)) {
              upstream.push({ file: resolvedPath, distance: 1, kind: 'imports', direct: true });
            }
          }
        }
      }
    } catch {
      // Unreadable
    }

    // Scan all other workspace files to find who references target (Downstream)
    for (const file of allFiles) {
      if (file.relPath === relTarget) continue;

      try {
        const content = readFileSync(file.absPath, 'utf8');

        // Check if file mentions targetBase or targetNameNoExt
        if (content.includes(targetBase) || (targetNameNoExt.length > 3 && content.includes(targetNameNoExt))) {
          // Verify relevance
          const isReferenced =
            content.includes(`(${targetBase}`) ||
            content.includes(`/${targetBase}`) ||
            content.includes(`"${targetBase}"`) ||
            content.includes(`'${targetBase}'`) ||
            content.includes(`from '${targetNameNoExt}'`) ||
            content.includes(`from "./${targetNameNoExt}"`);

          if (isReferenced) {
            downstream.push({
              file: file.relPath,
              distance: 1,
              kind: 'references',
              direct: true,
            });
          }
        }
      } catch {
        // Skip unreadable
      }
    }

    const directCount = downstream.length;
    const riskLevel = directCount > 3 ? 'HIGH' : directCount > 0 ? 'MEDIUM' : 'LOW';

    return {
      contract: IMPACT_SIMULATION_CONTRACT,
      target: relTarget,
      status: 'ANALYZED_FALLBACK',
      upstream,
      downstream,
      blastRadius: {
        totalFiles: downstream.length,
        directCount,
        indirectCount: 0,
        maxObservedDepth: downstream.length > 0 ? 1 : 0,
      },
      riskLevel,
      confidence: 0.85,
      unresolved,
      evidence: [
        {
          type: 'pattern-reference-scan',
          scannedFiles: allFiles.length,
          directMatches: directCount,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  _scanWorkspaceFiles() {
    const files = [];
    const traverse = (dir, depth = 0) => {
      if (depth > 6) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!['.git', 'node_modules', '.afyx-graph', '.afyx-backup', 'dist', 'build'].includes(entry.name)) {
              traverse(full, depth + 1);
            }
          } else if (entry.isFile()) {
            files.push({
              absPath: full,
              relPath: relative(this.workspaceRoot, full).replace(/\\/g, '/'),
            });
          }
        }
      } catch {
        // Skip
      }
    };
    traverse(this.workspaceRoot);
    return files;
  }
}
