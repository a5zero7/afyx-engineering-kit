import { describe, it, expect } from 'vitest';
import { extractFromSource } from '../src/extraction/extract';
import { isSourceFile, detectLanguage } from '../src/extraction/grammars';

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
});
