import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractFromSource } from '../src/extraction/extract';
import { isSourceFile, detectLanguage } from '../src/extraction/grammars';
import { AfyxGraph } from '../src/index';

describe('Track C Mixed Integration: Native Engineering Intelligence Pipeline', () => {
  it('correctly classifies Track C files as indexable source files with proper languages', () => {
    expect(isSourceFile('config/app.toml')).toBe(true);
    expect(isSourceFile('.env.production')).toBe(true);
    expect(isSourceFile('Dockerfile')).toBe(true);
    expect(isSourceFile('deploy/Dockerfile.stage')).toBe(true);
    expect(isSourceFile('docker-compose.yml')).toBe(true);
    expect(isSourceFile('.github/workflows/ci.yml')).toBe(true);
    expect(isSourceFile('.gitlab-ci.yml')).toBe(true);
    expect(isSourceFile('Jenkinsfile')).toBe(true);
    expect(isSourceFile('db/schema.sql')).toBe(true);
    expect(isSourceFile('api/openapi.yaml')).toBe(true);

    expect(detectLanguage('db/schema.sql')).toBe('cfquery');
    expect(detectLanguage('Dockerfile')).toBe('yaml');
    expect(detectLanguage('config.toml')).toBe('properties');
    expect(detectLanguage('app.ini')).toBe('properties');
  });

  it('dispatches seamlessly through extractFromSource for all five domains', () => {
    // 1. Config (AFYX-208)
    const configSource = `
[database]
host = "localhost"
port = 5432
password = "supersecretpass"
`;
    const configResult = extractFromSource('config.toml', configSource);
    expect(configResult.nodes.length).toBeGreaterThan(0);
    const passNode = configResult.nodes.find((n) => n.name.includes('password'));
    expect(passNode?.signature).toContain('[REDACTED]');

    // 2. Docker (AFYX-207)
    const dockerSource = `
FROM node:20 AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
`;
    const dockerResult = extractFromSource('Dockerfile', dockerSource);
    expect(dockerResult.nodes.filter((n) => n.kind === 'component').length).toBe(4);
    expect(dockerResult.edges.some((e) => e.kind === 'references')).toBe(true);

    // 3. CI/CD (AFYX-212)
    const cicdSource = `
name: Pipeline
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;
    const cicdResult = extractFromSource('.github/workflows/main.yml', cicdSource);
    expect(cicdResult.nodes.filter((n) => n.kind === 'component').length).toBe(2);
    expect(cicdResult.edges.some((e) => e.kind === 'references')).toBe(true);

    // 4. SQL (AFYX-209)
    const sqlSource = `
CREATE TABLE authors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE books (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    author_id INT REFERENCES authors(id)
);
`;
    const sqlResult = extractFromSource('migrations/schema.sql', sqlSource);
    expect(sqlResult.nodes.filter((n) => n.kind === 'class').length).toBe(2);
    expect(sqlResult.edges.some((e) => e.kind === 'references')).toBe(true);

    // 5. OpenAPI (AFYX-214)
    const openapiSource = `
openapi: 3.0.0
info:
  title: Book API
  version: 1.0.0
paths:
  /books:
    get:
      operationId: getBooks
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Book'
components:
  schemas:
    Book:
      type: object
      properties:
        id:
          type: integer
        title:
          type: string
`;
    const openapiResult = extractFromSource('openapi.yaml', openapiSource);
    expect(openapiResult.nodes.find((n) => n.kind === 'route')).toBeDefined();
    expect(openapiResult.nodes.find((n) => n.kind === 'type_alias' && n.name === 'Book')).toBeDefined();
    expect(openapiResult.edges.some((e) => e.kind === 'references')).toBe(true);
  });

  it('verifies end-to-end SQLite persistence, querying, incremental updates, and invalidation for Track C files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-trackc-e2e-'));
    let cg: AfyxGraph | undefined;

    try {
      fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'docker'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, '.github', 'workflows'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'db'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'api'), { recursive: true });

      // Config
      fs.writeFileSync(
        path.join(tmpDir, 'config', 'app.config.json'),
        JSON.stringify({ server: { host: '127.0.0.1', port: 9000 }, credentials: { token: 'secret' } }, null, 2)
      );
      fs.writeFileSync(path.join(tmpDir, '.env'), 'DATABASE_PORT=5432\nDB_PASS=secret123\n');

      // Docker
      fs.writeFileSync(
        path.join(tmpDir, 'docker', 'Dockerfile'),
        'FROM node:20-alpine\nWORKDIR /app\nEXPOSE 3000\n'
      );
      fs.writeFileSync(
        path.join(tmpDir, 'docker-compose.yml'),
        'version: "3.8"\nservices:\n  web:\n    build: ./docker\n    ports:\n      - "3000:3000"\n'
      );

      // CI/CD
      fs.writeFileSync(
        path.join(tmpDir, '.github', 'workflows', 'ci.yml'),
        'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
      );

      // SQL
      fs.writeFileSync(
        path.join(tmpDir, 'db', 'schema.sql'),
        'CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255) NOT NULL UNIQUE\n);\n'
      );

      // OpenAPI
      fs.writeFileSync(
        path.join(tmpDir, 'api', 'openapi.yaml'),
        'openapi: "3.0.0"\ninfo:\n  title: Test API\n  version: "1.0.0"\npaths:\n  /users:\n    get:\n      summary: List users\n'
      );

      cg = AfyxGraph.initSync(tmpDir);
      await cg.indexAll();

      // Verify Config nodes stored in SQLite
      const portNode = cg.getNodesByName('port')[0];
      expect(portNode).toBeDefined();
      const passNode = cg.getNodesByName('DB_PASS')[0];
      expect(passNode).toBeDefined();
      expect(passNode?.signature).toContain('[REDACTED]');

      // Verify Docker nodes
      const webService = cg.getNodesByName('web').find((n) => n.filePath.includes('docker-compose.yml'));
      expect(webService).toBeDefined();

      // Verify CI/CD nodes
      const testJob = cg.getNodesByName('test').find((n) => n.filePath.includes('ci.yml'));
      expect(testJob).toBeDefined();

      // Verify SQL nodes
      const usersTable = cg.getNodesByName('users').find((n) => n.kind === 'class');
      expect(usersTable).toBeDefined();

      // Verify OpenAPI nodes
      const openApiRoute = cg.getNodesByName('GET /users')[0];
      expect(openApiRoute).toBeDefined();

      // Incremental update test: append table in SQL
      fs.appendFileSync(
        path.join(tmpDir, 'db', 'schema.sql'),
        '\nCREATE TABLE orders (\n  id SERIAL PRIMARY KEY,\n  total NUMERIC\n);\n'
      );
      await cg.sync();

      const ordersTable = cg.getNodesByName('orders').find((n) => n.kind === 'class');
      expect(ordersTable).toBeDefined();

      // Invalidation test: delete SQL file
      const relSql = path.join('db', 'schema.sql').replace(/\\/g, '/');
      fs.rmSync(path.join(tmpDir, 'db', 'schema.sql'));
      await cg.sync();

      expect(cg.getNodesInFile(relSql)).toHaveLength(0);
      expect(cg.getNodesByName('users').find((n) => n.kind === 'class')).toBeUndefined();
      expect(cg.getNodesByName('orders').find((n) => n.kind === 'class')).toBeUndefined();
      expect(cg.getNodesByName('web')[0]).toBeDefined();
    } finally {
      if (cg) cg.destroy();
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });
});
