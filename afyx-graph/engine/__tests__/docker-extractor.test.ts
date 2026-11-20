import { describe, it, expect } from 'vitest';
import { DockerExtractor, isDockerRelatedFile, isDockerfile, isDockerCompose } from '../src/extraction/docker-extractor';

describe('AFYX-207: Dockerfile & Docker Compose Intelligence Extractor', () => {
  it('detects Docker files correctly', () => {
    expect(isDockerfile('Dockerfile')).toBe(true);
    expect(isDockerfile('Dockerfile.dev')).toBe(true);
    expect(isDockerfile('Dockerfile.prod')).toBe(true);
    expect(isDockerfile('deploy/frontend.dockerfile')).toBe(true);

    expect(isDockerCompose('docker-compose.yml')).toBe(true);
    expect(isDockerCompose('docker-compose.yaml')).toBe(true);
    expect(isDockerCompose('docker-compose.override.yml')).toBe(true);
    expect(isDockerCompose('compose.yml')).toBe(true);
    expect(isDockerCompose('compose.yaml')).toBe(true);

    expect(isDockerRelatedFile('Dockerfile')).toBe(true);
    expect(isDockerRelatedFile('docker-compose.yml')).toBe(true);

    // Negative tests
    expect(isDockerRelatedFile('package.json')).toBe(false);
    expect(isDockerRelatedFile('Makefile')).toBe(false);
  });

  it('extracts multi-stage Dockerfile stages and stage references', () => {
    const dockerfileSource = `
ARG NODE_VERSION=20-alpine
FROM node:\${NODE_VERSION} AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html
COPY --from=builder /app/dist .
EXPOSE 80
ENV APP_ENV=production
ENV API_SECRET_KEY=super-secret-token-value
CMD ["nginx", "-g", "daemon off;"]
`;

    const extractor = new DockerExtractor('Dockerfile', dockerfileSource);
    const result = extractor.extract();

    const stageNodes = result.nodes.filter((n) => n.kind === 'component');
    const stageNames = stageNodes.map((n) => n.name);
    expect(stageNames).toContain('builder');
    expect(stageNames).toContain('runner');

    // Stage runner has reference to stage builder via COPY --from=builder
    const runnerNode = stageNodes.find((n) => n.name === 'runner');
    const builderNode = stageNodes.find((n) => n.name === 'builder');
    expect(runnerNode).toBeDefined();
    expect(builderNode).toBeDefined();

    const stageRefEdge = result.edges.find(
      (e) => e.source === runnerNode?.id && e.target === builderNode?.id && e.kind === 'references'
    );
    expect(stageRefEdge).toBeDefined();

    // Secret redaction on ENV
    const secretNode = result.nodes.find((n) => n.name === 'API_SECRET_KEY');
    expect(secretNode).toBeDefined();
    expect(secretNode?.signature).toContain('[REDACTED]');
    expect(secretNode?.signature).not.toContain('super-secret-token-value');

    // Unresolved ENV var in FROM
    const envRefs = result.unresolvedReferences.map((r) => r.referenceName);
    expect(envRefs).toContain('NODE_VERSION');
  });

  it('extracts Docker Compose services, depends_on, ports, and volumes', () => {
    const composeSource = `
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_PASSWORD: mysecretpassword
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build: .
    depends_on:
      - db
      - redis
    environment:
      DATABASE_URL: postgres://postgres:\${DB_PASS}@db:5432/myapp
      PORT: 8000
    ports:
      - "8000:8000"

volumes:
  pgdata:
`;

    const extractor = new DockerExtractor('docker-compose.yml', composeSource);
    const result = extractor.extract();

    const serviceNodes = result.nodes.filter((n) => n.kind === 'component');
    const serviceNames = serviceNodes.map((n) => n.name);
    expect(serviceNames).toContain('db');
    expect(serviceNames).toContain('redis');
    expect(serviceNames).toContain('api');

    const apiNode = serviceNodes.find((n) => n.name === 'api');
    const dbNode = serviceNodes.find((n) => n.name === 'db');
    const redisNode = serviceNodes.find((n) => n.name === 'redis');

    // depends_on edges
    const apiToDb = result.edges.find(
      (e) => e.source === apiNode?.id && e.target === dbNode?.id && e.kind === 'references'
    );
    expect(apiToDb).toBeDefined();

    const apiToRedis = result.edges.find(
      (e) => e.source === apiNode?.id && e.target === redisNode?.id && e.kind === 'references'
    );
    expect(apiToRedis).toBeDefined();

    // Secret redaction in Compose environment
    const pgPass = result.nodes.find((n) => n.name === 'POSTGRES_PASSWORD');
    expect(pgPass).toBeDefined();
    expect(pgPass?.signature).toContain('[REDACTED]');

    // Unresolved env ref
    const envRefs = result.unresolvedReferences.map((r) => r.referenceName);
    expect(envRefs).toContain('DB_PASS');
  });
});
