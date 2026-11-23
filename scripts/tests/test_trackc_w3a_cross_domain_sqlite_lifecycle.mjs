import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { extractFromSource } from '../../afyx-graph/engine/src/extraction/extract.ts';
import { classifyEntityDomain, getEntityTaxonomy } from '../../afyx-graph/engine/src/extraction/taxonomy.ts';
import { crossDomainSourceBuildContainerEdges } from '../../afyx-graph/engine/src/resolution/cross-domain-source-build-container.ts';
import { crossDomainCicdInfraDbApiEdges } from '../../afyx-graph/engine/src/resolution/cross-domain-cicd-infra-db-api.ts';

describe('Track C Wave 3A Cross-Domain SQLite Lifecycle Integration Tests (AFYX-227 & AFYX-228)', () => {
  let tempDir;
  let db;

  const createDummyContext = (nodes, fileMap) => {
    return {
      getNodesInFile: (filePath) => nodes.filter(n => n.filePath === filePath),
      getNodesByName: (name) => nodes.filter(n => n.name === name),
      getNodesByQualifiedName: (qName) => nodes.filter(n => n.qualifiedName === qName),
      getNodesByKind: (kind) => nodes.filter(n => n.kind === kind),
      getAllFiles: () => Object.keys(fileMap),
      readFile: (filePath) => fileMap[filePath] || null,
      getNodesByLowerName: (lowerName) => nodes.filter(n => n.name.toLowerCase() === lowerName),
      getNodeById: (id) => nodes.find(n => n.id === id) || null,
      fileExists: (filePath) => !!fileMap[filePath],
      getProjectRoot: () => tempDir,
      getImportMappings: () => [],
    };
  };

  test.beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-trackc-w3a-test-'));
    const dbPath = path.join(tempDir, 'graph.db');
    db = new DatabaseSync(dbPath);

    // Initialize canonical schema tables
    db.exec(`
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        language TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        docstring TEXT,
        signature TEXT,
        domain TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE edges (
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        kind TEXT NOT NULL,
        metadata TEXT,
        PRIMARY KEY (source, target, kind)
      );

      CREATE INDEX idx_edges_source ON edges(source);
      CREATE INDEX idx_edges_target ON edges(target);
      CREATE INDEX idx_nodes_file ON nodes(file_path);
    `);
  });

  test.afterEach(() => {
    if (db) {
      try { db.close(); } catch {}
    }
    if (tempDir && fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('executes full end-to-end multi-domain extraction, synthesis, and SQLite persistence', async () => {
    // 1. Prepare multi-domain project files
    const projectFiles = {
      // Domain 1: Code
      'src/index.ts': [
        'export function startApp() {',
        '  console.log("App starting");',
        '}',
      ].join('\n'),

      'src/models/user.ts': [
        'export class User {',
        '  id: string;',
        '  name: string;',
        '  email: string;',
        '}',
      ].join('\n'),

      // Domain 2: Runtime / Shell
      'scripts/build.sh': [
        '#!/usr/bin/env bash',
        'echo "Building project"',
        'npm run build',
        'node dist/index.js',
      ].join('\n'),

      // Domain 3: Build
      'package.json': JSON.stringify({
        name: 'afyx-ecommerce',
        version: '1.0.0',
        main: 'src/index.ts',
        scripts: {
          build: 'tsc -p .',
          test: 'vitest run',
        },
        dependencies: {
          express: '^4.19.0',
        },
      }, null, 2),

      'Makefile': [
        'all: build',
        'build: src/index.ts',
        '\tnpm run build',
      ].join('\n'),

      // Domain 4: Infrastructure / Containers
      'Dockerfile': [
        'FROM node:20-alpine',
        'WORKDIR /app',
        'COPY package.json ./',
        'RUN npm install',
        'COPY src/ ./src/',
        'CMD ["npm", "start"]',
      ].join('\n'),

      'docker-compose.yml': [
        'version: "3.8"',
        'services:',
        '  web:',
        '    build: .',
        '    ports:',
        '      - "3000:3000"',
      ].join('\n'),

      // Domain 5: CI/CD
      '.github/workflows/ci.yml': [
        'name: CI',
        'on: [push]',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v3',
        '      - name: Build container',
        '        run: docker build -t myapp .',
        '      - name: Run Playbook',
        '        run: ansible-playbook playbooks/site.yml',
      ].join('\n'),

      // Domain 6: Ansible Automation
      'playbooks/site.yml': [
        '- name: Deploy Stack',
        '  hosts: webservers',
        '  tasks:',
        '    - name: Ensure docker_container running',
        '      community.docker.docker_container:',
        '        name: web_app',
        '        image: myapp:latest',
      ].join('\n'),

      // Domain 7: API / Schema
      'schemas/user.schema.json': JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'UserSchema',
        $defs: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      }, null, 2),
    };

    // 2. Perform static extraction for all files
    const allExtractedNodes = [];
    const allExtractedEdges = [];

    for (const [relPath, content] of Object.entries(projectFiles)) {
      const extResult = extractFromSource(relPath, content);
      for (const node of extResult.nodes) {
        allExtractedNodes.push(node);
      }
      for (const edge of extResult.edges) {
        allExtractedEdges.push(edge);
      }
    }

    assert.ok(allExtractedNodes.length > 10, 'Should extract nodes across all files');

    // 3. Run Cross-Domain Synthesizers
    const ctx = createDummyContext(allExtractedNodes, projectFiles);
    const noopYield = async () => {};

    // C6.1: Source <-> Build <-> Container
    const sourceBuildContainerEdges = await crossDomainSourceBuildContainerEdges(ctx, noopYield);
    assert.ok(sourceBuildContainerEdges.length > 0, 'Should synthesize Source-Build-Container edges');

    // C6.2: CI/CD <-> Infra <-> DB <-> API
    const cicdInfraDbApiEdges = await crossDomainCicdInfraDbApiEdges(ctx, noopYield);
    assert.ok(cicdInfraDbApiEdges.length > 0, 'Should synthesize CI/CD-Infra-DB-API edges');

    const totalEdges = [
      ...allExtractedEdges,
      ...sourceBuildContainerEdges,
      ...cicdInfraDbApiEdges,
    ];

    // 4. Persist to SQLite
    const insertNode = db.prepare(`
      INSERT INTO nodes (
        id, kind, name, qualified_name, file_path, language,
        start_line, end_line, start_column, end_column,
        docstring, signature, domain, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const nodeIds = new Set();
    for (const node of allExtractedNodes) {
      if (nodeIds.has(node.id)) continue;
      nodeIds.add(node.id);
      const domain = classifyEntityDomain(node);
      insertNode.run(
        node.id,
        node.kind,
        node.name,
        node.qualifiedName,
        node.filePath,
        node.language,
        node.startLine,
        node.endLine,
        node.startColumn,
        node.endColumn,
        node.docstring || null,
        node.signature || null,
        domain,
        node.updatedAt || Date.now()
      );
    }

    const insertEdge = db.prepare(`
      INSERT OR IGNORE INTO edges (source, target, kind, metadata)
      VALUES (?, ?, ?, ?)
    `);

    for (const edge of totalEdges) {
      // Only insert edges where both endpoints exist in nodes
      if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        insertEdge.run(edge.source, edge.target, edge.kind, JSON.stringify(edge.metadata || {}));
      }
    }

    // 5. Verification Queries on SQLite
    // A. Assert Zero Dangling Edges
    const danglingQuery = db.prepare(`
      SELECT e.source, e.target, e.kind
      FROM edges e
      LEFT JOIN nodes s ON e.source = s.id
      LEFT JOIN nodes t ON e.target = t.id
      WHERE s.id IS NULL OR t.id IS NULL
    `).all();
    assert.equal(danglingQuery.length, 0, 'There must be zero dangling edges in the database');

    // B. Assert Domain Coverage
    const domainsQuery = db.prepare(`SELECT DISTINCT domain FROM nodes ORDER BY domain`).all();
    const discoveredDomains = domainsQuery.map(r => r.domain);
    assert.ok(discoveredDomains.includes('code'));
    assert.ok(discoveredDomains.includes('build'));
    assert.ok(discoveredDomains.includes('infrastructure_containers'));
    assert.ok(discoveredDomains.includes('api_schema'));

    // C. Assert Cross-Domain Edges Exist
    const crossDomainEdgesQuery = db.prepare(`
      SELECT e.kind, s.domain as source_domain, t.domain as target_domain
      FROM edges e
      JOIN nodes s ON e.source = s.id
      JOIN nodes t ON e.target = t.id
      WHERE s.domain != t.domain
    `).all();
    assert.ok(crossDomainEdgesQuery.length > 0, 'Cross-domain edges must connect disparate engineering domains');

    // 6. Incremental Update Verification
    // Mutate package.json to add a new script
    const updatedPkg = JSON.stringify({
      name: 'afyx-ecommerce',
      version: '1.0.1',
      main: 'src/index.ts',
      scripts: {
        build: 'tsc -p .',
        test: 'vitest run',
        lint: 'eslint .',
      },
    }, null, 2);

    projectFiles['package.json'] = updatedPkg;
    const reExtracted = extractFromSource('package.json', updatedPkg);

    // Delete old nodes/edges for package.json
    db.prepare(`DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = 'package.json')`).run();
    db.prepare(`DELETE FROM edges WHERE target IN (SELECT id FROM nodes WHERE file_path = 'package.json')`).run();
    db.prepare(`DELETE FROM nodes WHERE file_path = 'package.json'`).run();

    // Re-insert new nodes
    for (const node of reExtracted.nodes) {
      const domain = classifyEntityDomain(node);
      insertNode.run(
        node.id,
        node.kind,
        node.name,
        node.qualifiedName,
        node.filePath,
        node.language,
        node.startLine,
        node.endLine,
        node.startColumn,
        node.endColumn,
        node.docstring || null,
        node.signature || null,
        domain,
        Date.now()
      );
    }

    const lintNode = db.prepare(`SELECT * FROM nodes WHERE name = 'lint' AND file_path = 'package.json'`).get();
    assert.ok(lintNode, 'Newly added script must be present after incremental update');

    // 7. Invalidation & Cascade Deletion Lifecycle
    // Delete Makefile and assert its nodes and edges are purged cleanly
    db.prepare(`DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = 'Makefile')`).run();
    db.prepare(`DELETE FROM edges WHERE target IN (SELECT id FROM nodes WHERE file_path = 'Makefile')`).run();
    db.prepare(`DELETE FROM nodes WHERE file_path = 'Makefile'`).run();

    const makefileNodes = db.prepare(`SELECT COUNT(*) as cnt FROM nodes WHERE file_path = 'Makefile'`).get();
    assert.equal(makefileNodes.cnt, 0, 'Deleted file nodes must be purged');

    const remainingDangling = db.prepare(`
      SELECT e.source, e.target
      FROM edges e
      LEFT JOIN nodes s ON e.source = s.id
      LEFT JOIN nodes t ON e.target = t.id
      WHERE s.id IS NULL OR t.id IS NULL
    `).all();
    assert.equal(remainingDangling.length, 0, 'Post-deletion must retain 0 dangling edges');
  });
});
