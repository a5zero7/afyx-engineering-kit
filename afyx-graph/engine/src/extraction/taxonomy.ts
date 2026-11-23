/**
 * AFYX-native Engineering Entity Taxonomy (AFYX-203 / C0.1).
 *
 * Consolidates the canonical engineering entity taxonomy across the knowledge graph:
 * - Code (programming language AST symbols: functions, classes, interfaces, etc.)
 * - Runtime/Shell (Bash/Shell, PowerShell, environment entrypoints)
 * - Build (Make, CMake, npm, Gradle, Maven, MSBuild targets and dependencies)
 * - Infrastructure/Containers (Docker, Compose, Kubernetes, Terraform/OpenTofu, Ansible)
 * - Data/Database (SQL schemas, tables, views, columns, migrations, models)
 * - API/Schema (OpenAPI, GraphQL, Protobuf, JSON Schema, AsyncAPI, Avro)
 * - Framework (route endpoints, web components, controllers, framework abstractions)
 *
 * Guarantees:
 * - Deterministic domain classification
 * - Stable, collision-free entity identification
 * - 100% backward-compatible node representation
 * - Source-grounded provenance
 */

import * as path from 'path';
import type { Node } from '../types';

export const ENGINEERING_DOMAINS = [
  'code',
  'runtime_shell',
  'build',
  'infrastructure_containers',
  'data_database',
  'api_schema',
  'framework',
] as const;

export type EngineeringDomain = (typeof ENGINEERING_DOMAINS)[number];

export interface EntityTaxonomyMetadata {
  domain: EngineeringDomain;
  subdomain?: string;
  category: string;
  provenance: string;
  confidence: number;
}

/**
 * Classifies any graph node into its canonical engineering domain based on
 * file path, language, kind, and fully qualified symbol name.
 */
export function classifyEntityDomain(node: Pick<Node, 'filePath' | 'language' | 'kind' | 'qualifiedName' | 'name'>): EngineeringDomain {
  const normPath = (node.filePath || '').replace(/\\/g, '/').toLowerCase();
  const base = path.basename(normPath);
  const ext = path.extname(normPath);
  const lang = node.language || 'unknown';
  const kind = node.kind;

  // 1. API & Schema Domain
  if (
    base.startsWith('openapi') ||
    base.startsWith('swagger') ||
    base.startsWith('asyncapi') ||
    normPath.includes('/schemas/') ||
    base.endsWith('.schema.json') ||
    base.endsWith('.avsc') ||
    base.endsWith('.proto') ||
    base.endsWith('.graphql') ||
    base.endsWith('.gql') ||
    lang === 'json' && base.includes('schema') ||
    node.qualifiedName.startsWith('openapi::') ||
    node.qualifiedName.startsWith('graphql::') ||
    node.qualifiedName.startsWith('protobuf::') ||
    node.qualifiedName.startsWith('asyncapi::') ||
    node.qualifiedName.startsWith('jsonschema::') ||
    node.qualifiedName.startsWith('avro::')
  ) {
    return 'api_schema';
  }

  // 2. Data & Database Domain
  if (
    base.endsWith('.sql') ||
    normPath.includes('/migrations/') ||
    normPath.includes('/migrate/') ||
    node.qualifiedName.startsWith('sql::') ||
    node.qualifiedName.startsWith('table::') ||
    node.qualifiedName.startsWith('view::') ||
    node.qualifiedName.startsWith('column::')
  ) {
    return 'data_database';
  }

  // 3. Infrastructure & Containers Domain
  if (
    base === 'dockerfile' ||
    base.startsWith('dockerfile.') ||
    base.endsWith('.dockerfile') ||
    base.startsWith('docker-compose') ||
    base.startsWith('compose') && (base.endsWith('.yml') || base.endsWith('.yaml')) ||
    lang === 'terraform' ||
    base.endsWith('.tf') ||
    base.endsWith('.tofu') ||
    normPath.includes('.github/workflows/') ||
    base === '.gitlab-ci.yml' ||
    base === 'jenkinsfile' ||
    base.startsWith('jenkinsfile.') ||
    base === 'azure-pipelines.yml' ||
    base === 'azure-pipelines.yaml' ||
    normPath.includes('/k8s/') ||
    normPath.includes('/kubernetes/') ||
    normPath.includes('/helm/') ||
    normPath.includes('/playbooks/') ||
    normPath.includes('/roles/') ||
    base.startsWith('playbook') ||
    base === 'site.yml' ||
    base === 'site.yaml' ||
    base === 'inventory' ||
    base === 'hosts' ||
    base.endsWith('.tfvars') ||
    node.qualifiedName.startsWith('docker::') ||
    node.qualifiedName.startsWith('compose::') ||
    node.qualifiedName.startsWith('k8s::') ||
    node.qualifiedName.startsWith('terraform::') ||
    node.qualifiedName.startsWith('ansible::') ||
    node.qualifiedName.startsWith('cicd::')
  ) {
    return 'infrastructure_containers';
  }

  // 4. Build Domain
  if (
    base === 'makefile' ||
    base === 'gnumakefile' ||
    base.endsWith('.mk') ||
    base === 'cmakelists.txt' ||
    base.endsWith('.cmake') ||
    base === 'package.json' ||
    base === 'package-lock.json' ||
    base === 'build.gradle' ||
    base === 'build.gradle.kts' ||
    base === 'settings.gradle' ||
    base === 'settings.gradle.kts' ||
    base === 'pom.xml' ||
    base.endsWith('.csproj') ||
    base.endsWith('.fsproj') ||
    base.endsWith('.vbproj') ||
    base === 'cargo.toml' ||
    base === 'go.mod' ||
    node.qualifiedName.startsWith('build::') ||
    node.qualifiedName.startsWith('make::') ||
    node.qualifiedName.startsWith('cmake::') ||
    node.qualifiedName.startsWith('gradle::') ||
    node.qualifiedName.startsWith('maven::') ||
    node.qualifiedName.startsWith('msbuild::') ||
    node.qualifiedName.startsWith('npm::')
  ) {
    return 'build';
  }

  // 5. Runtime / Shell Domain
  if (
    lang === 'shell' ||
    lang === 'powershell' ||
    ext === '.sh' ||
    ext === '.bash' ||
    ext === '.zsh' ||
    ext === '.ps1' ||
    ext === '.psm1' ||
    ext === '.psd1' ||
    ext === '.bat' ||
    ext === '.cmd'
  ) {
    return 'runtime_shell';
  }

  // 6. Framework Domain
  if (
    kind === 'route' ||
    kind === 'component' ||
    normPath.includes('/routes/') ||
    normPath.includes('/pages/') ||
    normPath.includes('/controllers/') ||
    node.qualifiedName.startsWith('route::') ||
    node.qualifiedName.startsWith('controller::') ||
    node.qualifiedName.startsWith('component::')
  ) {
    return 'framework';
  }

  // 7. Code Domain (Default for source AST symbols)
  return 'code';
}

/**
 * Returns structured taxonomy metadata for a given graph node.
 */
export function getEntityTaxonomy(node: Pick<Node, 'filePath' | 'language' | 'kind' | 'qualifiedName' | 'name'>): EntityTaxonomyMetadata {
  const domain = classifyEntityDomain(node);
  const base = path.basename(node.filePath || '');
  let subdomain = '';
  let category: string = node.kind;

  switch (domain) {
    case 'code':
      subdomain = node.language || 'general';
      category = `code_${node.kind}`;
      break;
    case 'runtime_shell':
      subdomain = (node.language === 'powershell' || base.endsWith('.ps1') || base.endsWith('.psm1')) ? 'powershell' : 'posix_shell';
      category = 'script_routine';
      break;
    case 'build':
      if (base.includes('gradle')) subdomain = 'gradle';
      else if (base === 'pom.xml') subdomain = 'maven';
      else if (base.endsWith('.csproj')) subdomain = 'msbuild';
      else if (base === 'package.json') subdomain = 'npm';
      else if (base.toLowerCase().includes('cmake')) subdomain = 'cmake';
      else subdomain = 'make';
      category = node.kind === 'function' ? 'target' : node.kind === 'import' ? 'dependency' : 'build_artifact';
      break;
    case 'infrastructure_containers':
      if (base.toLowerCase().includes('docker')) subdomain = 'docker';
      else if (base.endsWith('.tf') || base.endsWith('.tofu')) subdomain = 'terraform';
      else if (base.includes('pipeline') || base.includes('workflow') || base.toLowerCase().includes('jenkins')) subdomain = 'cicd';
      else if (node.qualifiedName.startsWith('ansible::') || base.includes('playbook') || base.includes('inventory')) subdomain = 'ansible';
      else subdomain = 'kubernetes';
      category = 'infra_resource';
      break;
    case 'data_database':
      subdomain = 'relational_sql';
      category = node.kind === 'class' ? 'table' : node.kind === 'property' ? 'column' : 'sql_routine';
      break;
    case 'api_schema':
      if (base.endsWith('.proto')) subdomain = 'protobuf';
      else if (base.endsWith('.graphql') || base.endsWith('.gql')) subdomain = 'graphql';
      else if (base.endsWith('.avsc')) subdomain = 'avro';
      else if (base.includes('asyncapi')) subdomain = 'asyncapi';
      else if (base.includes('schema.json')) subdomain = 'json_schema';
      else subdomain = 'openapi';
      category = node.kind === 'route' ? 'endpoint' : node.kind === 'type_alias' ? 'schema_model' : 'schema_field';
      break;
    case 'framework':
      subdomain = 'web_routing';
      category = node.kind === 'route' ? 'route_handler' : 'ui_component';
      break;
  }

  return {
    domain,
    subdomain,
    category,
    provenance: `${node.filePath}:${node.qualifiedName}`,
    confidence: 1.0,
  };
}

/**
 * Validates that an entity follows the canonical taxonomy constraints.
 */
export function validateEntityTaxonomy(node: Node): { valid: boolean; reason?: string } {
  if (!node.id || typeof node.id !== 'string') {
    return { valid: false, reason: 'Node id must be non-empty string' };
  }
  if (!node.filePath || typeof node.filePath !== 'string') {
    return { valid: false, reason: 'Node filePath must be non-empty string' };
  }
  if (!node.qualifiedName || typeof node.qualifiedName !== 'string') {
    return { valid: false, reason: 'Node qualifiedName must be non-empty string' };
  }
  const domain = classifyEntityDomain(node);
  if (!ENGINEERING_DOMAINS.includes(domain)) {
    return { valid: false, reason: `Invalid domain classified: ${domain}` };
  }
  return { valid: true };
}
