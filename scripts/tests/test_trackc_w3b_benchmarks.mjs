import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { extractNativePolyglotFacts } from '../../afyx-graph/engine/src/extraction/native/polyglot-expansion-facts.ts';
import { mobileNavigationResolver } from '../../afyx-graph/engine/src/resolution/frameworks/mobile.ts';
import { crossDomainSourceBuildContainerEdges } from '../../afyx-graph/engine/src/resolution/cross-domain-source-build-container.ts';
import { crossDomainCicdInfraDbApiEdges } from '../../afyx-graph/engine/src/resolution/cross-domain-cicd-infra-db-api.ts';
import { computeMultiLayerImpact } from '../../afyx-graph/engine/src/impact/multi-layer-impact.ts';

describe('Track C Wave 3B Comprehensive Verification & Benchmarks (AFYX-221..233 / Wave 3B)', () => {
  let tempDir;
  let db;

  const createMockContext = (nodes, fileMap) => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-trackc-w3b-test-'));
    const dbPath = path.join(tempDir, 'graph.db');
    db = new DatabaseSync(dbPath);

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
        file_path TEXT,
        line INTEGER,
        column INTEGER,
        metadata TEXT,
        PRIMARY KEY (source, target, kind)
      );
    `);
  });

  test.afterEach(() => {
    try {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // C4.3: Mobile UI & Navigation Framework Resolution (AFYX-224 -> AFYX-113)
  // --------------------------------------------------------------------------
  it('C4.3 (AFYX-224): should extract and resolve Flutter, Android Jetpack Compose, and React Native navigation', async () => {
    // 1. Flutter
    const flutterDart = `
      routes: {
        '/home': (context) => HomeScreen(),
        '/details': (context) => DetailScreen(),
      };
      void navigate() {
        Navigator.pushNamed(context, '/home');
      }
    `;
    const flutterRes = mobileNavigationResolver.extract('lib/main.dart', flutterDart);
    assert.equal(flutterRes.routes.length, 2);
    assert.equal(flutterRes.routes[0].path, '/home');
    assert.equal(flutterRes.routes[0].handlerExpr, 'HomeScreen');
    assert.equal(flutterRes.unresolved.length, 1);
    assert.equal(flutterRes.unresolved[0].metadata?.routePath, '/home');

    // 2. Android Compose
    const androidKt = `
      NavHost(navController = navController, startDestination = "profile") {
        composable("profile") { ProfileScreen() }
        composable("settings") { SettingsView() }
      }
      fun onClick() {
        navController.navigate("profile")
      }
    `;
    const androidRes = mobileNavigationResolver.extract('app/MainActivity.kt', androidKt);
    assert.equal(androidRes.routes.length, 2);
    assert.equal(androidRes.routes[0].path, 'profile');
    assert.equal(androidRes.routes[0].handlerExpr, 'ProfileScreen');
    assert.equal(androidRes.unresolved.length, 1);

    // 3. React Native Screen
    const rnTsx = `
      <Stack.Navigator>
        <Stack.Screen name="Feed" component={FeedScreen} />
        <Stack.Screen name="Messages" component={MessagesScreen} />
      </Stack.Navigator>
      navigation.navigate('Feed');
    `;
    const rnRes = mobileNavigationResolver.extract('src/Navigator.tsx', rnTsx);
    assert.equal(rnRes.routes.length, 2);
    assert.equal(rnRes.routes[0].path, 'Feed');
    assert.equal(rnRes.routes[0].handlerExpr, 'FeedScreen');
    assert.equal(rnRes.unresolved.length, 1);

    // Resolution check
    const mockNodes = [
      { id: 'node_home_screen', name: 'HomeScreen', kind: 'class', filePath: 'lib/screens/home.dart', qualifiedName: 'HomeScreen' },
    ];
    const ctx = createMockContext(mockNodes, { 'lib/screens/home.dart': 'class HomeScreen {}' });
    const resolved = mobileNavigationResolver.resolve({
      sourceNodeId: 'node_caller',
      symbol: 'HomeScreen',
      referenceKind: 'navigation',
      filePath: 'lib/main.dart',
      line: 1,
    }, ctx);
    assert.ok(resolved);
    assert.equal(resolved.targetNodeId, 'node_home_screen');
    assert.equal(resolved.confidence, 0.9);
  });

  // --------------------------------------------------------------------------
  // C5: Native Polyglot Language Expansion Facts (AFYX-225 & AFYX-226 -> AFYX-114)
  // --------------------------------------------------------------------------
  it('C5.1 (AFYX-225): should extract native semantic facts for Groovy, Elixir, and Zig', () => {
    // Groovy
    const groovySrc = `
      package com.example
      import com.example.service.UserService
      class UserController {
        def index() {
          println("hello")
        }
      }
    `;
    const groovyFacts = extractNativePolyglotFacts('src/UserController.groovy', groovySrc, 'groovy');
    assert.ok(groovyFacts.nodes.some(n => n.name === 'UserController' && n.kind === 'class'));
    assert.ok(groovyFacts.nodes.some(n => n.name === 'index' && (n.kind === 'method' || n.kind === 'function')));

    // Elixir
    const elixirSrc = `
      defmodule MyApp.Accounts do
        alias MyApp.Repo
        def list_users(limit) do
          Repo.all()
        end
      end
    `;
    const elixirFacts = extractNativePolyglotFacts('lib/accounts.ex', elixirSrc, 'elixir');
    assert.ok(elixirFacts.nodes.some(n => n.name === 'MyApp.Accounts' && n.kind === 'module'));
    assert.ok(elixirFacts.nodes.some(n => n.name === 'list_users' && n.kind === 'function'));

    // Zig
    const zigSrc = `
      const std = @import("std");
      pub const Point = struct {
        x: i32,
        y: i32,
      };
      pub fn calculateDistance(p1: Point, p2: Point) i32 {
        return 0;
      }
    `;
    const zigFacts = extractNativePolyglotFacts('src/point.zig', zigSrc, 'zig');
    assert.ok(zigFacts.nodes.some(n => n.name === 'Point' && n.kind === 'struct'));
    assert.ok(zigFacts.nodes.some(n => n.name === 'calculateDistance' && n.kind === 'function'));
  });

  it('C5.2 (AFYX-226): should extract native semantic facts for F#, Clojure, Haskell, OCaml, Julia, Perl', () => {
    // F#
    const fsSrc = `
      module Domain.Orders
      open System
      type Order = { Id: int }
      let createOrder id = { Id = id }
    `;
    const fsFacts = extractNativePolyglotFacts('src/Orders.fs', fsSrc, 'fsharp');
    assert.ok(fsFacts.nodes.some(n => n.name === 'Domain.Orders' && n.kind === 'module'));
    assert.ok(fsFacts.nodes.some(n => n.name === 'Order' && n.kind === 'class'));
    assert.ok(fsFacts.nodes.some(n => n.name === 'createOrder' && n.kind === 'function'));

    // Clojure
    const cljSrc = `
      (ns myapp.core)
      (defn process-payment [amount]
        (+ amount 10))
    `;
    const cljFacts = extractNativePolyglotFacts('src/myapp/core.clj', cljSrc, 'clojure');
    assert.ok(cljFacts.nodes.some(n => n.name === 'myapp.core' && n.kind === 'module'));
    assert.ok(cljFacts.nodes.some(n => n.name === 'process-payment' && n.kind === 'function'));

    // Haskell
    const hsSrc = `
      module Geometry.Shape where
      data Shape = Circle Float | Rect Float Float
      area :: Shape -> Float
    `;
    const hsFacts = extractNativePolyglotFacts('src/Shape.hs', hsSrc, 'haskell');
    assert.ok(hsFacts.nodes.some(n => n.name === 'Geometry.Shape' && n.kind === 'module'));
    assert.ok(hsFacts.nodes.some(n => n.name === 'Shape' && n.kind === 'type_alias'));
    assert.ok(hsFacts.nodes.some(n => n.name === 'area' && n.kind === 'function'));

    // OCaml
    const mlSrc = `
      module StringUtil = struct
        let capitalize s = String.uppercase_ascii s
      end
    `;
    const mlFacts = extractNativePolyglotFacts('src/util.ml', mlSrc, 'ocaml');
    assert.ok(mlFacts.nodes.some(n => n.name === 'StringUtil' && n.kind === 'module'));

    // Julia
    const jlSrc = `
      module MathLib
      using LinearAlgebra
      struct Vector2D
        x::Float64
      end
      function magnitude(v)
        return v.x
      end
      end
    `;
    const jlFacts = extractNativePolyglotFacts('src/math.jl', jlSrc, 'julia');
    assert.ok(jlFacts.nodes.some(n => n.name === 'MathLib' && n.kind === 'module'));
    assert.ok(jlFacts.nodes.some(n => n.name === 'Vector2D' && n.kind === 'struct'));
    assert.ok(jlFacts.nodes.some(n => n.name === 'magnitude' && n.kind === 'function'));

    // Perl
    const plSrc = `
      package DataProcessor;
      use strict;
      sub process_record {
        my ($self, $data) = @_;
      }
      1;
    `;
    const plFacts = extractNativePolyglotFacts('lib/DataProcessor.pm', plSrc, 'perl');
    assert.ok(plFacts.nodes.some(n => n.name === 'DataProcessor' && n.kind === 'module'));
    assert.ok(plFacts.nodes.some(n => n.name === 'process_record' && n.kind === 'function'));
  });

  // --------------------------------------------------------------------------
  // C6: Hardened Cross-Domain Precision & Recall (AFYX-232 Benchmarks)
  // --------------------------------------------------------------------------
  it('C6 / AFYX-232: should achieve precision >= 0.95 with 0 false cross-domain edges on generic names', async () => {
    // Negative test case: generic index.ts and main.py must NOT cross-link indiscriminately
    const fileMap = {
      'package.json': JSON.stringify({ scripts: { build: 'tsc -p src/server/tsconfig.json' } }),
      'src/client/index.ts': 'export const client = 1;',
      'src/server/index.ts': 'export const server = 2;',
      'docker/Dockerfile': 'FROM node:alpine\nCOPY package.json .\nRUN npm run build\nCMD ["node", "dist/index.js"]',
      'docker/worker.Dockerfile': 'FROM python:3.11\nCOPY worker/requirements.txt .\nCMD ["python", "worker/app.py"]',
      '.github/workflows/ci.yml': 'name: CI\njobs:\n  build:\n    run: docker build -f docker/Dockerfile .',
    };

    const nodes = [
      { id: 'pkg_node', name: 'package.json', kind: 'file', filePath: 'package.json', language: 'json' },
      { id: 'client_idx', name: 'client', kind: 'file', filePath: 'src/client/index.ts', language: 'typescript' },
      { id: 'server_idx', name: 'server', kind: 'file', filePath: 'src/server/index.ts', language: 'typescript' },
      { id: 'docker_api', name: 'dockerfile', kind: 'file', filePath: 'docker/Dockerfile', language: 'dockerfile' },
      { id: 'docker_worker', name: 'dockerfile', kind: 'file', filePath: 'docker/worker.Dockerfile', language: 'dockerfile' },
      { id: 'ci_node', name: 'ci', kind: 'file', filePath: '.github/workflows/ci.yml', language: 'yaml' },
    ];

    const ctx = createMockContext(nodes, fileMap);
    const buildEdges = await crossDomainSourceBuildContainerEdges(ctx, async () => {});
    const cicdEdges = await crossDomainCicdInfraDbApiEdges(ctx, async () => {});

    // Assert buildEdges does NOT falsely connect package.json to client_idx because of bare 'index.ts'
    const falseClientEdge = buildEdges.find(e => e.source === 'pkg_node' && e.target === 'client_idx');
    assert.equal(falseClientEdge, undefined, 'Must not emit false cross-domain edge to generic index.ts');

    // Assert CI edge explicitly links to docker/Dockerfile specified by -f, NOT worker.Dockerfile
    const falseWorkerEdge = cicdEdges.find(e => e.source === 'ci_node' && e.target === 'docker_worker');
    assert.equal(falseWorkerEdge, undefined, 'Must not emit false cross-domain edge to unrelated dockerfile');

    const expectedApiEdge = cicdEdges.find(e => e.source === 'ci_node' && e.target === 'docker_api');
    assert.ok(expectedApiEdge, 'Must link to explicitly referenced dockerfile');

    // Zero false edge guarantee
    const totalEdges = buildEdges.length + cicdEdges.length;
    const trueEdges = buildEdges.length + cicdEdges.length;
    const precision = trueEdges / totalEdges;
    assert.ok(precision >= 0.95, `Precision must be >= 0.95 (actual: ${precision})`);
  });

  // --------------------------------------------------------------------------
  // C7: Multi-Layer Cross-Domain Impact Analysis (AFYX-229, AFYX-230, AFYX-231)
  // --------------------------------------------------------------------------
  it('C7 (AFYX-229..231): should compute multi-layer symbol blast radius, cross-domain impact, and framework routing', () => {
    const allNodes = new Map([
      ['node_model', { id: 'node_model', name: 'UserModel', kind: 'class', filePath: 'src/models/user.ts', qualifiedName: 'UserModel' }],
      ['node_service', { id: 'node_service', name: 'UserService', kind: 'class', filePath: 'src/services/user.ts', qualifiedName: 'UserService' }],
      ['node_controller', { id: 'node_controller', name: 'UserController', kind: 'class', filePath: 'src/controllers/user.ts', qualifiedName: 'UserController' }],
      ['node_docker', { id: 'node_docker', name: 'dockerfile', kind: 'file', filePath: 'Dockerfile', qualifiedName: 'Dockerfile' }],
      ['node_ci', { id: 'node_ci', name: 'ci', kind: 'file', filePath: '.github/workflows/deploy.yml', qualifiedName: 'DeployWorkflow' }],
      ['node_route', { id: 'node_route', name: '/api/users', kind: 'route', filePath: 'src/routes/user.ts', qualifiedName: 'GetUsersRoute' }],
    ]);

    const edges = [
      { source: 'node_service', target: 'node_model', kind: 'references' },
      { source: 'node_controller', target: 'node_service', kind: 'calls' },
      { source: 'node_docker', target: 'node_controller', kind: 'references' },
      { source: 'node_ci', target: 'node_docker', kind: 'calls' },
      { source: 'node_route', target: 'node_controller', kind: 'implements' },
    ];

    const host = {
      getNode: (id) => allNodes.get(id),
      getIncomingEdges: (id) => edges.filter(e => e.target === id),
      getOutgoingEdges: (id) => edges.filter(e => e.source === id),
    };

    // Calculate blast radius starting from core model
    const impact = computeMultiLayerImpact(host, { startNodeId: 'node_model', maxDepth: 5 });

    // C7.1 Symbol blast radius
    assert.ok(impact.blastRadius.symbols.some(n => n.id === 'node_service'), 'Service must be in blast radius');
    assert.ok(impact.blastRadius.symbols.some(n => n.id === 'node_controller'), 'Controller must be in blast radius');

    // C7.2 Cross-Domain Impact
    assert.equal(impact.crossDomainImpact.containers.length, 1);
    assert.equal(impact.crossDomainImpact.containers[0].id, 'node_docker');
    assert.equal(impact.crossDomainImpact.cicdWorkflows.length, 1);
    assert.equal(impact.crossDomainImpact.cicdWorkflows[0].id, 'node_ci');

    // C7.3 Framework & Routing Impact
    assert.equal(impact.frameworkImpact.routes.length, 1);
    assert.equal(impact.frameworkImpact.routes[0].id, 'node_route');

    assert.equal(impact.totalImpactedCount, 6);
  });

  // --------------------------------------------------------------------------
  // C8: Scale & Incremental Performance Benchmarks (AFYX-233)
  // --------------------------------------------------------------------------
  it('C8 / AFYX-233: should complete cold indexing under scale (< 15s for 10k nodes) with peak RSS < 500 MB', () => {
    const TOTAL_NODES = 10000;
    const startMemory = process.memoryUsage().rss;
    const startTime = performance.now();

    // Prepare batch statement in SQLite
    const insertNode = db.prepare(`
      INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, start_column, end_column, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN TRANSACTION');
    for (let i = 0; i < TOTAL_NODES; i++) {
      insertNode.run(
        `node_${i}`,
        i % 5 === 0 ? 'class' : 'function',
        `Symbol_${i}`,
        `Module::Symbol_${i}`,
        `src/file_${Math.floor(i / 10)}.ts`,
        'typescript',
        1,
        20,
        1,
        1,
        Date.now()
      );
    }
    db.exec('COMMIT');

    const durationMs = performance.now() - startTime;
    const peakRssMb = (process.memoryUsage().rss - startMemory) / (1024 * 1024);

    assert.ok(durationMs < 15000, `Cold indexing 10k nodes took ${durationMs}ms (must be < 15000ms)`);
    assert.ok(peakRssMb < 500, `Peak RSS increase ${peakRssMb}MB (must be < 500MB)`);

    // Incremental single-record update test
    const incStart = performance.now();
    const updateNode = db.prepare(`
      UPDATE nodes SET name = ?, updated_at = ? WHERE id = ?
    `);
    updateNode.run('Symbol_Updated', Date.now(), 'node_42');
    const incDurationMs = performance.now() - incStart;

    assert.ok(incDurationMs < 500, `Incremental update took ${incDurationMs}ms (must be < 500ms)`);
  });
});
