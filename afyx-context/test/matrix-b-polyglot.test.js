import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  WorkLedger,
  ImpactSimulator,
  DbInspector,
  CliCompactor,
  MassiveContextNavigator,
} from '../src/index.js';
import {
  ContractValidator,
  MigrationPlanner,
} from '../../afyx-forge/src/index.js';

describe('Matrix B — Polyglot & Multi-Database Workspaces (POSTV1-UNIVERSAL-TOOLS-C03)', () => {
  it('validates polyglot multi-domain dependencies, schemas, and API contracts', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-matrix-b-polyglot-'));

    try {
      // 1. Setup multi-domain fixtures
      fs.mkdirSync(path.join(tmpDir, 'proto'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'graphql'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'db'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'api'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'infra'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'src', 'services'), { recursive: true });

      // Protocol Buffers
      const protoPath = path.join(tmpDir, 'proto', 'service.proto');
      fs.writeFileSync(
        protoPath,
        `syntax = "proto3";\npackage billing;\nservice BillingService {\n  rpc ProcessPayment (PaymentRequest) returns (PaymentResponse);\n}\nmessage PaymentRequest { string id = 1; }\nmessage PaymentResponse { bool success = 1; }\n`
      );

      // GraphQL SDL
      const gqlPath = path.join(tmpDir, 'graphql', 'schema.graphql');
      fs.writeFileSync(
        gqlPath,
        `type Query {\n  getAccount(id: ID!): Account\n}\ntype Account {\n  id: ID!\n  balance: Float!\n}\n`
      );

      // OpenAPI 3.0
      const openApiPath = path.join(tmpDir, 'api', 'openapi.yaml');
      fs.writeFileSync(
        openApiPath,
        `openapi: "3.0.0"\ninfo:\n  title: Core Service API\n  version: "1.0.0"\npaths:\n  /accounts:\n    get:\n      summary: List accounts\n`
      );

      // SQL Schema
      const sqlPath = path.join(tmpDir, 'db', 'schema.sql');
      fs.writeFileSync(
        sqlPath,
        `CREATE TABLE accounts (\n  id SERIAL PRIMARY KEY,\n  owner VARCHAR(100) NOT NULL\n);\nCREATE TABLE transactions (\n  id SERIAL PRIMARY KEY,\n  account_id INT REFERENCES accounts(id)\n);\n`
      );

      // Dockerfile & Compose
      const dockerPath = path.join(tmpDir, 'Dockerfile');
      fs.writeFileSync(dockerPath, `FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "src/services/billing.js"]\n`);

      // Node.js Service that references proto & service
      const nodeServicePath = path.join(tmpDir, 'src', 'services', 'billing.js');
      fs.writeFileSync(
        nodeServicePath,
        `import { loadPackageDefinition } from "@grpc/grpc-js";\n// References service.proto\nconst protoPath = "../../proto/service.proto";\n`
      );

      // Python Service
      const pyServicePath = path.join(tmpDir, 'src', 'services', 'worker.py');
      fs.writeFileSync(pyServicePath, `# Connects to BillingService\nSERVICE_NAME = "BillingService"\n`);

      // Test 1: API & Schema Contract Validation
      const validator = new ContractValidator(tmpDir);

      // Protobuf Validation
      const protoVal = validator.validate('proto/service.proto', { contractType: 'protobuf' });
      assert.strictEqual(protoVal.status, 'PASS');

      // GraphQL Validation
      const gqlVal = validator.validate('graphql/schema.graphql', { contractType: 'graphql' });
      assert.strictEqual(gqlVal.status, 'PASS');

      // OpenAPI Validation
      const openApiVal = validator.validate('api/openapi.yaml', { contractType: 'openapi' });
      assert.strictEqual(openApiVal.status, 'PASS');

      // Test 2: Cross-domain Impact Analysis (Deterministic Fallback)
      const simulator = new ImpactSimulator(tmpDir);
      const protoImpact = simulator.simulate('proto/service.proto');
      assert.strictEqual(protoImpact.status, 'ANALYZED_FALLBACK');
      // billing.js references service.proto
      assert.strictEqual(protoImpact.downstream.some((d) => d.file.includes('billing.js')), true);

      // Test 3: DB Inspector with External Catalog contracts
      const dbInspector = new DbInspector(tmpDir);
      const pgCatalog = dbInspector.inspectExternalCatalog('postgres');
      assert.strictEqual(pgCatalog.status, 'NOT_AVAILABLE');
      assert.strictEqual(pgCatalog.dialect, 'postgres');

      // Test 4: Massive Context on Polyglot Codebase
      const navigator = new MassiveContextNavigator(tmpDir, { chunkSizeBytes: 300 });
      const idxResult = navigator.indexWorkspace();
      assert.strictEqual(idxResult.status, 'INDEXED');
      assert.ok(idxResult.indexedFiles >= 6);

      const queryResult = navigator.retrieveContext('BillingService ProcessPayment');
      assert.strictEqual(queryResult.status, 'RETRIEVED');
      assert.ok(queryResult.segments.length > 0);
      assert.ok(queryResult.segments.some((s) => s.file.includes('service.proto')));

      // Test 5: CLI Compactor with Preserved Failures on Polyglot Output (Vitest + Pytest)
      const compactor = new CliCompactor();
      const passingLines = Array.from({ length: 25 }, (_, i) => ` ✓ src/services/module_${i}.test.ts (10 tests) 12ms`).join('\n');
      const vitestOutputWithFailure = `
 RUN  v4.1.11 /app

${passingLines}
 ❯ src/services/payment.test.ts (2 tests | 1 failed) 30ms
   × throws on insufficient funds 5ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/services/payment.test.ts > throws on insufficient funds
AssertionError: expected 'BALANCE_TOO_LOW' but received 'SUCCESS'
 ❯ src/services/payment.test.ts:42:15
    40|   it('throws on insufficient funds', () => {
    41|     const res = processPayment({ balance: 0, amount: 100 });
    42|     expect(res.error).toBe('BALANCE_TOO_LOW');
      |                       ^
    43|   });

 Test Files  1 failed | 25 passed (26)
      Tests  1 failed | 250 passed (251)
   Duration  450ms
`;
      const vitestCompacted = compactor.compact(vitestOutputWithFailure, { command: 'vitest' });
      assert.ok(vitestCompacted.failuresPreserved >= 1);
      assert.ok(vitestCompacted.compactedOutput.includes('AssertionError: expected \'BALANCE_TOO_LOW\''));
      assert.ok(vitestCompacted.compactedOutput.includes('src/services/payment.test.ts:42:15'));
      assert.ok(vitestCompacted.compactedOutput.includes('<!-- AFYX-CLI-COMPACTED -->'));
      assert.ok(vitestCompacted.reductionPercent > 20);

      // Verify raw file spill exists
      assert.ok(vitestCompacted.spillFilePath);
      assert.strictEqual(fs.existsSync(vitestCompacted.spillFilePath), true);
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });
});
