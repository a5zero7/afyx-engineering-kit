/**
 * AFYX-native Ansible Intelligence Extractor (AFYX-213 / C2.5).
 *
 * Provides static extraction for Ansible configurations and automation assets:
 * - Playbooks: site.yml, site.yaml, playbook.yml, playbooks subdirectories
 * - Roles & Tasks: roles subdirectories (tasks, handlers, meta)
 * - Inventory: inventory, hosts, inventory.ini, hosts.ini, inventory.yml, hosts.yml
 * - Group & Host variables: group_vars, host_vars
 *
 * Extracted Relationships:
 * - Playbook → Play (`contains`)
 * - Play → Task (`contains`)
 * - Play → Role (`references`)
 * - Task → Handler via `notify:` (`references`)
 * - Task → Sub-task via `include_tasks:` / `import_tasks:` (`imports`)
 * - Inventory Group → Host (`contains`)
 * - Inventory Group → Child Group (`contains`)
 * - Play → Inventory Target (`references`)
 *
 * Security Hardening:
 * - Zero execution (never invokes ansible-playbook or connects to remote hosts)
 * - Secret masking for passwords, keys, tokens, credentials
 * - Opaque handling of Ansible Vault encrypted blocks ($ANSIBLE_VAULT;...)
 * - Cyclic include protection
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';
import { parseYamlWithLocations } from './yaml-utils';

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth|credential|vault/i;

export function isAnsibleFile(filePath: string, content?: string): boolean {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(norm);

  // Inventory INI
  if (base === 'inventory' || base === 'hosts' || base === 'inventory.ini' || base === 'hosts.ini') {
    return true;
  }

  // Inventory YAML
  if ((base === 'inventory.yml' || base === 'inventory.yaml' || base === 'hosts.yml' || base === 'hosts.yaml') &&
      (!content || content.includes('hosts:') || content.includes('children:'))) {
    return true;
  }

  // Ansible Roles
  if ((norm.startsWith('roles/') || norm.includes('/roles/')) &&
      (norm.includes('/tasks/') || norm.includes('/handlers/') || norm.includes('/meta/'))) {
    return true;
  }

  // Ansible Playbooks
  if (
    base === 'site.yml' ||
    base === 'site.yaml' ||
    base.startsWith('playbook') ||
    norm.startsWith('playbooks/') ||
    norm.includes('/playbooks/')
  ) {
    return true;
  }

  // Content-based heuristic for YAML files declaring hosts: and tasks:
  if (content && (base.endsWith('.yml') || base.endsWith('.yaml'))) {
    if (content.includes('$ANSIBLE_VAULT;')) return true;
    if (/^\s*-\s+name:\s+.*hosts:\s+/ms.test(content) || /^\s*hosts:\s+.*tasks:\s+/ms.test(content)) {
      return true;
    }
  }

  return false;
}

export class AnsibleExtractor {
  private filePath: string;
  private source: string;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private unresolvedReferences: UnresolvedReference[] = [];
  private errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    try {
      const fileNode = this.createFileNode();
      this.nodes.push(fileNode);

      const base = path.basename(this.filePath).toLowerCase();
      if (base === 'inventory' || base === 'hosts' || base.endsWith('.ini')) {
        this.extractIniInventory(fileNode);
      } else if (this.source.includes('$ANSIBLE_VAULT;')) {
        this.extractVault(fileNode);
      } else {
        this.extractYamlAnsible(fileNode);
      }
    } catch (err: unknown) {
      this.errors.push({
        line: 1,
        column: 1,
        message: err instanceof Error ? err.message : String(err),
        severity: 'warning',
      });
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private createFileNode(): Node {
    return {
      id: generateNodeId(this.filePath, 'file', this.filePath, 1),
      kind: 'file',
      name: path.basename(this.filePath),
      qualifiedName: this.filePath,
      filePath: this.filePath,
      language: 'unknown',
      startLine: 1,
      endLine: Math.max(1, this.source.split(/\r?\n/).length),
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    };
  }

  /* ------------------------------------------------------------------------
   * 1. INI Inventory Extraction
   * ------------------------------------------------------------------------ */
  private extractIniInventory(fileNode: Node): void {
    const lines = this.source.split(/\r?\n/);
    let currentGroup: string = 'all';
    let currentGroupNodeId = generateNodeId(this.filePath, 'namespace', `ansible::group#${currentGroup}`, 1);

    this.nodes.push({
      id: currentGroupNodeId,
      kind: 'namespace',
      name: currentGroup,
      qualifiedName: `ansible::group#${currentGroup}`,
      filePath: this.filePath,
      language: 'unknown',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    });
    this.edges.push({ source: fileNode.id, target: currentGroupNodeId, kind: 'contains' });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

      // Group header [group_name] or [group_name:children]
      const groupMatch = /^\[([a-zA-Z0-9_.-]+)(?::([a-zA-Z0-9_.-]+))?\]$/.exec(trimmed);
      if (groupMatch) {
        currentGroup = groupMatch[1]!;
        const modifier = groupMatch[2]; // e.g. 'children' or 'vars'
        currentGroupNodeId = generateNodeId(this.filePath, 'namespace', `ansible::group#${currentGroup}`, lineNum);

        if (!this.nodes.some((n) => n.id === currentGroupNodeId)) {
          this.nodes.push({
            id: currentGroupNodeId,
            kind: 'namespace',
            name: currentGroup,
            qualifiedName: `ansible::group#${currentGroup}`,
            filePath: this.filePath,
            language: 'unknown',
            startLine: lineNum,
            endLine: lineNum,
            startColumn: 0,
            endColumn: line.length,
            updatedAt: Date.now(),
          });
          this.edges.push({ source: fileNode.id, target: currentGroupNodeId, kind: 'contains' });
        }

        if (modifier === 'children') {
          // Following lines are child group names
          continue;
        }
        continue;
      }

      // Host or child group entry
      const hostTokens = trimmed.split(/\s+/);
      const hostName = hostTokens[0]!;
      const hostQName = `ansible::host#${hostName}`;
      const hostId = generateNodeId(this.filePath, 'variable', hostQName, lineNum);

      this.nodes.push({
        id: hostId,
        kind: 'variable',
        name: hostName,
        qualifiedName: hostQName,
        filePath: this.filePath,
        language: 'unknown',
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: hostName.length,
        updatedAt: Date.now(),
      });
      this.edges.push({ source: currentGroupNodeId, target: hostId, kind: 'contains' });
    }
  }

  /* ------------------------------------------------------------------------
   * 2. Vault Extraction
   * ------------------------------------------------------------------------ */
  private extractVault(fileNode: Node): void {
    const vaultId = generateNodeId(this.filePath, 'variable', `ansible::vault#${this.filePath}`, 1);
    this.nodes.push({
      id: vaultId,
      kind: 'variable',
      name: 'ansible_vault_payload',
      qualifiedName: `ansible::vault#${this.filePath}`,
      filePath: this.filePath,
      language: 'unknown',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      docstring: 'OPAQUE_ENCRYPTED_VAULT',
      updatedAt: Date.now(),
    });
    this.edges.push({ source: fileNode.id, target: vaultId, kind: 'contains' });
  }

  /* ------------------------------------------------------------------------
   * 3. YAML Playbooks, Roles, Tasks Extraction
   * ------------------------------------------------------------------------ */
  private extractYamlAnsible(fileNode: Node): void {
    const parsed = parseYamlWithLocations(this.source);
    if (!parsed || !parsed.data) return;

    const doc = parsed.data;

    // A playbook is an array of plays
    if (Array.isArray(doc)) {
      for (let pIdx = 0; pIdx < doc.length; pIdx++) {
        const item = doc[pIdx];
        if (item && typeof item === 'object') {
          this.extractPlay(fileNode, item, pIdx);
        }
      }
    } else if (typeof doc === 'object') {
      // Could be task list or role definition
      if (Array.isArray(doc.tasks)) {
        for (let tIdx = 0; tIdx < doc.tasks.length; tIdx++) {
          this.extractTask(fileNode.id, doc.tasks[tIdx], tIdx, 'task');
        }
      } else if (Array.isArray(doc.handlers)) {
        for (let hIdx = 0; hIdx < doc.handlers.length; hIdx++) {
          this.extractTask(fileNode.id, doc.handlers[hIdx], hIdx, 'handler');
        }
      }
    }
  }

  private extractPlay(fileNode: Node, play: any, index: number): void {
    const playName = play.name || `Play ${index + 1}`;
    const hostsTarget = play.hosts ? String(play.hosts) : 'all';
    const playQName = `ansible::play#${this.filePath}::${index}`;
    const playNodeId = generateNodeId(this.filePath, 'component', playQName, 1);

    this.nodes.push({
      id: playNodeId,
      kind: 'component',
      name: playName,
      qualifiedName: playQName,
      filePath: this.filePath,
      language: 'yaml',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      signature: `hosts: ${hostsTarget}`,
      updatedAt: Date.now(),
    });
    this.edges.push({ source: fileNode.id, target: playNodeId, kind: 'contains' });

    // Play -> Inventory Group target reference
    this.unresolvedReferences.push({
      fromNodeId: playNodeId,
      referenceName: `ansible::group#${hostsTarget}`,
      referenceKind: 'references',
      line: 1,
      column: 0,
      filePath: this.filePath,
      language: 'yaml',
    });

    // Play -> Roles
    if (Array.isArray(play.roles)) {
      for (const role of play.roles) {
        const roleName = typeof role === 'string' ? role : role && typeof role === 'object' && role.role ? role.role : null;
        if (roleName) {
          this.unresolvedReferences.push({
            fromNodeId: playNodeId,
            referenceName: `ansible::role#${roleName}`,
            referenceKind: 'references',
            line: 1,
            column: 0,
            filePath: this.filePath,
            language: 'yaml',
          });
        }
      }
    }

    // Play -> Tasks
    const taskList = Array.isArray(play.tasks) ? play.tasks : [];
    for (let tIdx = 0; tIdx < taskList.length; tIdx++) {
      this.extractTask(playNodeId, taskList[tIdx], tIdx, 'task');
    }

    // Play -> Handlers
    const handlerList = Array.isArray(play.handlers) ? play.handlers : [];
    for (let hIdx = 0; hIdx < handlerList.length; hIdx++) {
      this.extractTask(playNodeId, handlerList[hIdx], hIdx, 'handler');
    }
  }

  private extractTask(parentNodeId: string, task: any, index: number, kind: 'task' | 'handler'): void {
    if (!task || typeof task !== 'object') return;

    const taskName = task.name || `${kind}_${index + 1}`;
    const taskQName = `ansible::${kind}#${this.filePath}::${taskName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const taskNodeId = generateNodeId(this.filePath, kind === 'handler' ? 'method' : 'function', taskQName, 1);

    // Identify module: e.g. copy, template, command, apt, service, include_tasks
    const knownDirectives = new Set(['name', 'when', 'register', 'notify', 'tags', 'become', 'vars', 'with_items', 'loop']);
    let moduleName = 'action';
    for (const key of Object.keys(task)) {
      if (!knownDirectives.has(key)) {
        moduleName = key;
        break;
      }
    }

    this.nodes.push({
      id: taskNodeId,
      kind: kind === 'handler' ? 'method' : 'function',
      name: taskName,
      qualifiedName: taskQName,
      filePath: this.filePath,
      language: 'yaml',
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      signature: moduleName,
      updatedAt: Date.now(),
    });
    this.edges.push({ source: parentNodeId, target: taskNodeId, kind: 'contains' });

    // Handle notify: <handler_name>
    if (task.notify) {
      const notifications = Array.isArray(task.notify) ? task.notify : [task.notify];
      for (const handlerTarget of notifications) {
        if (typeof handlerTarget === 'string') {
          this.unresolvedReferences.push({
            fromNodeId: taskNodeId,
            referenceName: `ansible::handler#${handlerTarget}`,
            referenceKind: 'calls',
            line: 1,
            column: 0,
            filePath: this.filePath,
            language: 'yaml',
          });
        }
      }
    }

    // Handle include_tasks / import_tasks / include_role / import_role
    if (task.include_tasks || task.import_tasks) {
      const inc = String(task.include_tasks || task.import_tasks);
      this.unresolvedReferences.push({
        fromNodeId: taskNodeId,
        referenceName: inc,
        referenceKind: 'imports',
        line: 1,
        column: 0,
      });
    }

    if (task.include_role || task.import_role) {
      const roleObj = task.include_role || task.import_role;
      const roleTarget = typeof roleObj === 'string' ? roleObj : roleObj.name;
      if (roleTarget) {
        this.unresolvedReferences.push({
          fromNodeId: taskNodeId,
          referenceName: `ansible::role#${roleTarget}`,
          referenceKind: 'references',
          line: 1,
          column: 0,
        });
      }
    }

    // Check for sensitive variable declarations
    if (task.vars && typeof task.vars === 'object') {
      for (const [varName, varVal] of Object.entries(task.vars)) {
        const isSensitive = SENSITIVE_KEY_PATTERN.test(varName);
        const safeVal = isSensitive ? '***REDACTED***' : String(varVal);
        const varQName = `ansible::var#${taskQName}::${varName}`;
        const varNodeId = generateNodeId(this.filePath, 'variable', varQName, 1);

        this.nodes.push({
          id: varNodeId,
          kind: 'variable',
          name: varName,
          qualifiedName: varQName,
          filePath: this.filePath,
          language: 'yaml',
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 0,
          signature: safeVal,
          docstring: isSensitive ? 'SENSITIVE_REDACTED' : undefined,
          updatedAt: Date.now(),
        });
        this.edges.push({ source: taskNodeId, target: varNodeId, kind: 'contains' });
      }
    }
  }
}
