/**
 * AFYX-native CI/CD Pipeline Intelligence Extractor (AFYX-212).
 *
 * Provides static pipeline graph extraction across major CI/CD providers:
 * - GitHub Actions (`.github/workflows/*.yml`, `*.yaml`)
 * - GitLab CI (`.gitlab-ci.yml`, `.gitlab-ci.yaml`)
 * - Jenkins (`Jenkinsfile`, `Jenkinsfile.*`)
 * - Azure Pipelines (`azure-pipelines.yml`, `azure-pipelines.yaml`, `azure-pipeline.yml`)
 *
 * Extracted Relationships:
 * - Pipelines, stages, jobs, and tasks/steps
 * - Inter-job dependency relationships (`needs:`, `dependsOn:`)
 * - Reusable workflows and templates (`uses:`, `extends:`)
 * - Action/task imports (`actions/checkout@v4`, `task: Npm@1`)
 * - Workflow triggers (`on:`, `trigger:`)
 * - Secret-safe variable masking
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';
import { parseYamlWithLocations } from './yaml-utils';

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|auth|credential/i;

export function isCicdFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  if (norm.includes('.github/workflows/') && (base.endsWith('.yml') || base.endsWith('.yaml'))) {
    return true;
  }
  if (base === '.gitlab-ci.yml' || base === '.gitlab-ci.yaml') {
    return true;
  }
  if (base === 'jenkinsfile' || base.startsWith('jenkinsfile.')) {
    return true;
  }
  if (
    base === 'azure-pipelines.yml' ||
    base === 'azure-pipelines.yaml' ||
    base === 'azure-pipeline.yml' ||
    base === 'azure-pipeline.yaml'
  ) {
    return true;
  }
  return false;
}

export class CicdExtractor {
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
    const norm = this.filePath.replace(/\\/g, '/').toLowerCase();
    const base = path.basename(this.filePath).toLowerCase();

    try {
      const fileNode = this.createFileNode();

      if (norm.includes('.github/workflows/')) {
        this.extractGitHubActions(fileNode.id);
      } else if (base === '.gitlab-ci.yml' || base === '.gitlab-ci.yaml') {
        this.extractGitLabCi(fileNode.id);
      } else if (base === 'jenkinsfile' || base.startsWith('jenkinsfile.')) {
        this.extractJenkinsfile(fileNode.id);
      } else if (base.startsWith('azure-pipeline')) {
        this.extractAzurePipelines(fileNode.id);
      }
    } catch (err) {
      this.errors.push({
        message: `CI/CD extraction error in ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        filePath: this.filePath,
        severity: 'warning',
        code: 'cicd_parse_error',
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
    const lines = this.source.split(/\r?\n/);
    const fileName = path.basename(this.filePath);
    const id = generateNodeId(this.filePath, 'file', fileName, 1);

    const fileNode: Node = {
      id,
      kind: 'file',
      name: fileName,
      qualifiedName: this.filePath,
      filePath: this.filePath,
      language: 'yaml',
      startLine: 1,
      endLine: Math.max(lines.length, 1),
      startColumn: 0,
      endColumn: (lines[lines.length - 1] || '').length,
      updatedAt: Date.now(),
    };

    this.nodes.push(fileNode);
    return fileNode;
  }

  private extractGitHubActions(fileNodeId: string): void {
    const { data, lineMap, errors } = parseYamlWithLocations(this.source);
    if (errors.length > 0) {
      for (const e of errors) {
        this.errors.push({ message: e, filePath: this.filePath, severity: 'warning', code: 'gha_yaml_error' });
      }
    }
    if (!data || typeof data !== 'object') return;

    // Workflow name / trigger
    const workflowName = data.name ? String(data.name) : path.basename(this.filePath);
    const fileNode = this.nodes.find((n) => n.id === fileNodeId);
    if (fileNode) {
      fileNode.docstring = `Workflow: ${workflowName}`;
    }
    const triggerObj = data.on ?? data.true; // "on:" can parse as boolean true in naive YAML
    if (triggerObj) {
      const trigLine = lineMap.get('on') || 1;
      const trigText = typeof triggerObj === 'object' && !Array.isArray(triggerObj)
        ? Object.keys(triggerObj).join(', ')
        : String(triggerObj);
      const trigId = generateNodeId(this.filePath, 'property', `trigger:${trigText}`, trigLine);

      this.nodes.push({
        id: trigId,
        kind: 'property',
        name: `on: [${trigText}]`,
        qualifiedName: `${this.filePath}#trigger`,
        filePath: this.filePath,
        language: 'yaml',
        startLine: trigLine,
        endLine: trigLine,
        startColumn: 0,
        endColumn: 0,
        signature: `on: ${trigText}`,
        updatedAt: Date.now(),
      });
      this.edges.push({
        source: fileNodeId,
        target: trigId,
        kind: 'contains',
      });
    }

    const jobs = data.jobs;
    if (!jobs || typeof jobs !== 'object') return;

    const jobNodes = new Map<string, string>(); // jobId -> nodeId

    // First pass: register jobs
    for (const [jobKey, jobDef] of Object.entries(jobs)) {
      if (!jobDef || typeof jobDef !== 'object') continue;
      const jobLine = lineMap.get(`jobs.${jobKey}`) || 1;
      const jobId = generateNodeId(this.filePath, 'component', `job:${jobKey}`, jobLine);
      const jobName = (jobDef as any).name ? String((jobDef as any).name) : jobKey;

      this.nodes.push({
        id: jobId,
        kind: 'component',
        name: jobKey,
        qualifiedName: `${this.filePath}#job:${jobKey}`,
        filePath: this.filePath,
        language: 'yaml',
        startLine: jobLine,
        endLine: jobLine,
        startColumn: 0,
        endColumn: 0,
        signature: `job ${jobKey} ("${jobName}")`,
        updatedAt: Date.now(),
      });
      this.edges.push({
        source: fileNodeId,
        target: jobId,
        kind: 'contains',
      });
      jobNodes.set(jobKey.toLowerCase(), jobId);
    }

    // Second pass: dependencies and steps
    for (const [jobKey, jobDef] of Object.entries(jobs)) {
      if (!jobDef || typeof jobDef !== 'object') continue;
      const j = jobDef as Record<string, any>;
      const jobId = jobNodes.get(jobKey.toLowerCase())!;
      const jobLine = lineMap.get(`jobs.${jobKey}`) || 1;

      // needs: [jobA, jobB] or needs: jobA
      if (j.needs) {
        const needsList = Array.isArray(j.needs) ? j.needs.map(String) : [String(j.needs)];
        for (const req of needsList) {
          const targetId = jobNodes.get(req.toLowerCase());
          if (targetId) {
            this.edges.push({
              source: jobId,
              target: targetId,
              kind: 'references',
            });
          } else {
            this.unresolvedReferences.push({
              fromNodeId: jobId,
              referenceName: req,
              referenceKind: 'references',
              line: jobLine,
              column: 0,
            });
          }
        }
      }

      // uses: (reusable workflow)
      if (j.uses) {
        const actionRef = String(j.uses);
        const actionId = generateNodeId(this.filePath, 'import', `uses:${actionRef}`, jobLine);
        this.nodes.push({
          id: actionId,
          kind: 'import',
          name: actionRef,
          qualifiedName: `${this.filePath}#job:${jobKey}:uses:${actionRef}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: jobLine,
          endLine: jobLine,
          startColumn: 0,
          endColumn: 0,
          signature: `uses: ${actionRef}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: jobId,
          target: actionId,
          kind: 'references',
        });
      }

      // env: { KEY: VAL }
      if (j.env && typeof j.env === 'object') {
        for (const [envKey, envVal] of Object.entries(j.env)) {
          const envLine = lineMap.get(`jobs.${jobKey}.env.${envKey}`) || jobLine;
          const rawVal = String(envVal);
          const safeVal = SENSITIVE_KEY_PATTERN.test(envKey) ? '[REDACTED]' : rawVal;
          const envId = generateNodeId(this.filePath, 'variable', `env:${envKey}`, envLine);

          this.nodes.push({
            id: envId,
            kind: 'variable',
            name: envKey,
            qualifiedName: `${this.filePath}#job:${jobKey}:env:${envKey}`,
            filePath: this.filePath,
            language: 'yaml',
            startLine: envLine,
            endLine: envLine,
            startColumn: 0,
            endColumn: 0,
            signature: `${envKey}=${safeVal}`,
            updatedAt: Date.now(),
          });
          this.edges.push({
            source: jobId,
            target: envId,
            kind: 'contains',
          });
        }
      }

      // steps: [...]
      if (Array.isArray(j.steps)) {
        for (let sIdx = 0; sIdx < j.steps.length; sIdx++) {
          const step = j.steps[sIdx];
          if (!step || typeof step !== 'object') continue;
          const stepLine = lineMap.get(`jobs.${jobKey}.steps[${sIdx}]`) || jobLine;
          const stepName = step.name ? String(step.name) : (step.uses ? `uses ${step.uses}` : (step.run ? 'run script' : `step-${sIdx}`));

          if (step.uses) {
            const actRef = String(step.uses);
            const actId = generateNodeId(this.filePath, 'import', `action:${actRef}`, stepLine);
            this.nodes.push({
              id: actId,
              kind: 'import',
              name: actRef,
              qualifiedName: `${this.filePath}#job:${jobKey}:step:${sIdx}:uses:${actRef}`,
              filePath: this.filePath,
              language: 'yaml',
              startLine: stepLine,
              endLine: stepLine,
              startColumn: 0,
              endColumn: 0,
              signature: `uses: ${actRef}`,
              updatedAt: Date.now(),
            });
            this.edges.push({
              source: jobId,
              target: actId,
              kind: 'references',
            });
            this.unresolvedReferences.push({
              fromNodeId: jobId,
              referenceName: actRef,
              referenceKind: 'references',
              line: stepLine,
              column: 0,
            });
          } else {
            const stepId = generateNodeId(this.filePath, 'method', `step:${sIdx}:${stepName}`, stepLine);
            this.nodes.push({
              id: stepId,
              kind: 'method',
              name: stepName,
              qualifiedName: `${this.filePath}#job:${jobKey}:step:${sIdx}`,
              filePath: this.filePath,
              language: 'yaml',
              startLine: stepLine,
              endLine: stepLine,
              startColumn: 0,
              endColumn: 0,
              signature: `step: ${stepName}`,
              updatedAt: Date.now(),
            });
            this.edges.push({
              source: jobId,
              target: stepId,
              kind: 'contains',
            });
          }
        }
      }
    }
  }

  private extractGitLabCi(fileNodeId: string): void {
    const { data, lineMap, errors } = parseYamlWithLocations(this.source);
    if (errors.length > 0) {
      for (const e of errors) {
        this.errors.push({ message: e, filePath: this.filePath, severity: 'warning', code: 'gitlab_yaml_error' });
      }
    }
    if (!data || typeof data !== 'object') return;

    const reserved = new Set(['stages', 'variables', 'include', 'image', 'services', 'before_script', 'after_script']);
    const jobNodes = new Map<string, string>();

    // Stages
    if (Array.isArray(data.stages)) {
      for (const stg of data.stages) {
        const stageName = String(stg);
        const stgId = generateNodeId(this.filePath, 'namespace', `stage:${stageName}`, 1);
        this.nodes.push({
          id: stgId,
          kind: 'namespace',
          name: stageName,
          qualifiedName: `${this.filePath}#stage:${stageName}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 0,
          signature: `stage ${stageName}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: stgId,
          kind: 'contains',
        });
      }
    }

    // Jobs
    for (const [k, v] of Object.entries(data)) {
      if (reserved.has(k) || !v || typeof v !== 'object') continue;
      const jobLine = lineMap.get(k) || 1;
      const jobId = generateNodeId(this.filePath, 'component', `job:${k}`, jobLine);

      this.nodes.push({
        id: jobId,
        kind: 'component',
        name: k,
        qualifiedName: `${this.filePath}#job:${k}`,
        filePath: this.filePath,
        language: 'yaml',
        startLine: jobLine,
        endLine: jobLine,
        startColumn: 0,
        endColumn: 0,
        signature: `job ${k}`,
        updatedAt: Date.now(),
      });
      this.edges.push({
        source: fileNodeId,
        target: jobId,
        kind: 'contains',
      });
      jobNodes.set(k.toLowerCase(), jobId);
    }

    // Job relationships
    for (const [k, v] of Object.entries(data)) {
      if (reserved.has(k) || !v || typeof v !== 'object') continue;
      const j = v as Record<string, any>;
      const jobId = jobNodes.get(k.toLowerCase())!;
      const jobLine = lineMap.get(k) || 1;

      // needs
      if (j.needs) {
        const needsList = Array.isArray(j.needs) ? j.needs : [j.needs];
        for (const item of needsList) {
          const targetName = typeof item === 'string' ? item : (item && item.job ? String(item.job) : null);
          if (targetName) {
            const targetId = jobNodes.get(targetName.toLowerCase());
            if (targetId) {
              this.edges.push({ source: jobId, target: targetId, kind: 'references' });
            } else {
              this.unresolvedReferences.push({
                fromNodeId: jobId,
                referenceName: targetName,
                referenceKind: 'references',
                line: jobLine,
                column: 0,
              });
            }
          }
        }
      }

      // extends
      if (j.extends) {
        const extendsList = Array.isArray(j.extends) ? j.extends.map(String) : [String(j.extends)];
        for (const tmpl of extendsList) {
          const targetId = jobNodes.get(tmpl.toLowerCase());
          if (targetId) {
            this.edges.push({ source: jobId, target: targetId, kind: 'extends' });
          } else {
            this.unresolvedReferences.push({
              fromNodeId: jobId,
              referenceName: tmpl,
              referenceKind: 'extends',
              line: jobLine,
              column: 0,
            });
          }
        }
      }
    }
  }

  private extractJenkinsfile(fileNodeId: string): void {
    const lines = this.source.split(/\r?\n/);
    const stageRegex = /stage\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      let match: RegExpExecArray | null;
      stageRegex.lastIndex = 0;

      while ((match = stageRegex.exec(line)) !== null) {
        const stageName = match[1]!;
        const stageId = generateNodeId(this.filePath, 'component', `stage:${stageName}`, lineNum);

        this.nodes.push({
          id: stageId,
          kind: 'component',
          name: stageName,
          qualifiedName: `${this.filePath}#stage:${stageName}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: match.index,
          endColumn: match.index + match[0].length,
          signature: `stage('${stageName}')`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: stageId,
          kind: 'contains',
        });
      }
    }
  }

  private extractAzurePipelines(fileNodeId: string): void {
    const { data, lineMap, errors } = parseYamlWithLocations(this.source);
    if (errors.length > 0) {
      for (const e of errors) {
        this.errors.push({ message: e, filePath: this.filePath, severity: 'warning', code: 'azure_yaml_error' });
      }
    }
    if (!data || typeof data !== 'object') return;

    // Trigger
    if (data.trigger) {
      const trigLine = lineMap.get('trigger') || 1;
      const trigVal = Array.isArray(data.trigger) ? data.trigger.join(', ') : String(data.trigger);
      const trigId = generateNodeId(this.filePath, 'property', `trigger:${trigVal}`, trigLine);

      this.nodes.push({
        id: trigId,
        kind: 'property',
        name: `trigger: [${trigVal}]`,
        qualifiedName: `${this.filePath}#trigger`,
        filePath: this.filePath,
        language: 'yaml',
        startLine: trigLine,
        endLine: trigLine,
        startColumn: 0,
        endColumn: 0,
        signature: `trigger: ${trigVal}`,
        updatedAt: Date.now(),
      });
      this.edges.push({
        source: fileNodeId,
        target: trigId,
        kind: 'contains',
      });
    }

    const jobNodes = new Map<string, string>(); // jobName -> nodeId

    // Helper to process job list
    const processJobs = (jobsList: any[], stageNodeId?: string) => {
      for (let jIdx = 0; jIdx < jobsList.length; jIdx++) {
        const j = jobsList[jIdx];
        if (!j || typeof j !== 'object') continue;
        const jobName = j.job ? String(j.job) : (j.displayName ? String(j.displayName) : `job-${jIdx}`);
        const jobLine = lineMap.get(`jobs[${jIdx}]`) || 1;
        const jobId = generateNodeId(this.filePath, 'component', `job:${jobName}`, jobLine);

        this.nodes.push({
          id: jobId,
          kind: 'component',
          name: jobName,
          qualifiedName: `${this.filePath}#job:${jobName}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: jobLine,
          endLine: jobLine,
          startColumn: 0,
          endColumn: 0,
          signature: `job: ${jobName}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: stageNodeId || fileNodeId,
          target: jobId,
          kind: 'contains',
        });
        jobNodes.set(jobName.toLowerCase(), jobId);
      }

      // Second pass for dependsOn
      for (let jIdx = 0; jIdx < jobsList.length; jIdx++) {
        const j = jobsList[jIdx];
        if (!j || typeof j !== 'object') continue;
        const jobName = j.job ? String(j.job) : (j.displayName ? String(j.displayName) : `job-${jIdx}`);
        const jobId = jobNodes.get(jobName.toLowerCase())!;
        const jobLine = lineMap.get(`jobs[${jIdx}]`) || 1;

        if (j.dependsOn) {
          const deps = Array.isArray(j.dependsOn) ? j.dependsOn.map(String) : [String(j.dependsOn)];
          for (const dep of deps) {
            const targetId = jobNodes.get(dep.toLowerCase());
            if (targetId) {
              this.edges.push({ source: jobId, target: targetId, kind: 'references' });
            } else {
              this.unresolvedReferences.push({
                fromNodeId: jobId,
                referenceName: dep,
                referenceKind: 'references',
                line: jobLine,
                column: 0,
              });
            }
          }
        }
      }
    };

    if (Array.isArray(data.jobs)) {
      processJobs(data.jobs);
    } else if (Array.isArray(data.stages)) {
      for (let sIdx = 0; sIdx < data.stages.length; sIdx++) {
        const stg = data.stages[sIdx];
        if (!stg || typeof stg !== 'object') continue;
        const stageName = stg.stage ? String(stg.stage) : `stage-${sIdx}`;
        const stageLine = lineMap.get(`stages[${sIdx}]`) || 1;
        const stageId = generateNodeId(this.filePath, 'namespace', `stage:${stageName}`, stageLine);

        this.nodes.push({
          id: stageId,
          kind: 'namespace',
          name: stageName,
          qualifiedName: `${this.filePath}#stage:${stageName}`,
          filePath: this.filePath,
          language: 'yaml',
          startLine: stageLine,
          endLine: stageLine,
          startColumn: 0,
          endColumn: 0,
          signature: `stage: ${stageName}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: stageId,
          kind: 'contains',
        });

        if (Array.isArray(stg.jobs)) {
          processJobs(stg.jobs, stageId);
        }
      }
    }
  }
}
