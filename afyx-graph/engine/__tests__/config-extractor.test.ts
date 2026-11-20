import { describe, it, expect } from 'vitest';
import { ConfigExtractor, isConfigFile } from '../src/extraction/config-extractor';

describe('AFYX-208: Configuration Intelligence Extractor', () => {
  it('detects config files correctly', () => {
    expect(isConfigFile('.env')).toBe(true);
    expect(isConfigFile('.env.local')).toBe(true);
    expect(isConfigFile('.env.production')).toBe(true);
    expect(isConfigFile('app.properties')).toBe(true);
    expect(isConfigFile('config.toml')).toBe(true);
    expect(isConfigFile('settings.ini')).toBe(true);
    expect(isConfigFile('app.cfg')).toBe(true);
    expect(isConfigFile('tsconfig.json')).toBe(true);
    expect(isConfigFile('config.jsonc')).toBe(true);

    // Negative tests
    expect(isConfigFile('openapi.json')).toBe(false);
    expect(isConfigFile('swagger.json')).toBe(false);
    expect(isConfigFile('main.ts')).toBe(false);
    expect(isConfigFile('Dockerfile')).toBe(false);
  });

  it('extracts JSON and JSONC configs with key hierarchy', () => {
    const source = `{
      // System configuration
      "server": {
        "host": "0.0.0.0",
        "port": 8080
      },
      "database": {
        "url": "\${DATABASE_URL}",
        "max_connections": 10
      }
    }`;

    const extractor = new ConfigExtractor('config/app.jsonc', source);
    const result = extractor.extract();

    expect(result.errors).toHaveLength(0);
    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('server');
    expect(names).toContain('host');
    expect(names).toContain('port');
    expect(names).toContain('database');
    expect(names).toContain('url');

    const qnames = result.nodes.map((n) => n.qualifiedName);
    expect(qnames).toContain('config/app.jsonc#server.host');
    expect(qnames).toContain('config/app.jsonc#database.url');

    // Unresolved env ref
    const envRefs = result.unresolvedReferences.map((r) => r.referenceName);
    expect(envRefs).toContain('DATABASE_URL');
  });

  it('redacts sensitive values in JSON, TOML, INI, and .env files', () => {
    const envSource = `
# Environment Variables
PORT=3000
DB_PASSWORD=SuperSecretPass123!
API_KEY=sk-prod-9876543210abcdef
AUTH_TOKEN=jwt.eyJhbGciOiJIUzI1NiJ9
NORMAL_NAME=AfyxApp
`;

    const extractor = new ConfigExtractor('.env.production', envSource);
    const result = extractor.extract();

    const passNode = result.nodes.find((n) => n.name === 'DB_PASSWORD');
    expect(passNode).toBeDefined();
    expect(passNode?.signature).toContain('[REDACTED]');
    expect(passNode?.signature).not.toContain('SuperSecretPass123!');

    const keyNode = result.nodes.find((n) => n.name === 'API_KEY');
    expect(keyNode).toBeDefined();
    expect(keyNode?.signature).toContain('[REDACTED]');
    expect(keyNode?.signature).not.toContain('sk-prod');

    const normalNode = result.nodes.find((n) => n.name === 'NORMAL_NAME');
    expect(normalNode?.signature).toContain('AfyxApp');
  });

  it('extracts TOML configuration sections and properties', () => {
    const tomlSource = `
[package]
name = "my-service"
version = "0.1.0"

[database]
host = "localhost"
port = 5432
secret_token = "dont-leak-me"
`;

    const extractor = new ConfigExtractor('Cargo.toml', tomlSource);
    const result = extractor.extract();

    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('package');
    expect(names).toContain('name');
    expect(names).toContain('database');
    expect(names).toContain('host');

    const qnames = result.nodes.map((n) => n.qualifiedName);
    expect(qnames).toContain('Cargo.toml#package.name');
    expect(qnames).toContain('Cargo.toml#database.host');

    const tokenNode = result.nodes.find((n) => n.name === 'secret_token');
    expect(tokenNode).toBeDefined();
    expect(tokenNode?.signature).toContain('[REDACTED]');
  });

  it('extracts Java properties with dot-separated hierarchies', () => {
    const propSource = `
server.port=8080
spring.application.name=afyx-demo
spring.datasource.url=jdbc:postgresql://\${DB_HOST:-localhost}:5432/app
spring.datasource.password=TopSecretDb123
`;

    const extractor = new ConfigExtractor('app.properties', propSource);
    const result = extractor.extract();

    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('server.port');
    expect(names).toContain('spring.application.name');
    expect(names).toContain('spring.datasource.url');

    const passNode = result.nodes.find((n) => n.name === 'spring.datasource.password');
    expect(passNode?.signature).toContain('[REDACTED]');

    const envRefs = result.unresolvedReferences.map((r) => r.referenceName);
    expect(envRefs).toContain('DB_HOST');
  });

  it('propagates secret redaction through nested objects and arrays', () => {
    const jsonSource = `{
      "app": {
        "name": "public-app"
      },
      "credentials": {
        "username": "admin",
        "nested": {
          "token_endpoint": "https://auth.internal/token",
          "client_id": "oauth-client-id"
        }
      },
      "api_keys": [
        "key-alpha-12345",
        "key-beta-67890"
      ],
      "secrets_list": [
        {
          "secret_name": "db_master",
          "raw_token": "shh-secret"
        }
      ]
    }`;

    const extractor = new ConfigExtractor('config/secrets.json', jsonSource);
    const result = extractor.extract();

    // Regular config is NOT redacted
    const appNode = result.nodes.find((n) => n.qualifiedName === 'config/secrets.json#app.name');
    expect(appNode?.signature).toContain('"public-app"');

    // Nested properties under "credentials" MUST be redacted
    const userNode = result.nodes.find((n) => n.qualifiedName === 'config/secrets.json#credentials.username');
    expect(userNode).toBeDefined();
    expect(userNode?.signature).toContain('[REDACTED]');
    expect(userNode?.signature).not.toContain('admin');

    const tokenEndpointNode = result.nodes.find(
      (n) => n.qualifiedName === 'config/secrets.json#credentials.nested.token_endpoint'
    );
    expect(tokenEndpointNode).toBeDefined();
    expect(tokenEndpointNode?.signature).toContain('[REDACTED]');
    expect(tokenEndpointNode?.signature).not.toContain('https://auth.internal');

    // Array under sensitive key MUST be redacted
    const apiKey0 = result.nodes.find((n) => n.qualifiedName === 'config/secrets.json#api_keys[0]');
    expect(apiKey0?.signature).toContain('[REDACTED]');
    expect(apiKey0?.signature).not.toContain('key-alpha');

    // Array of objects under sensitive key MUST be redacted
    const secretObjVal = result.nodes.find(
      (n) => n.qualifiedName === 'config/secrets.json#secrets_list[0].raw_token'
    );
    expect(secretObjVal?.signature).toContain('[REDACTED]');
    expect(secretObjVal?.signature).not.toContain('shh-secret');
  });

  it('propagates secret redaction for TOML and INI sensitive sections', () => {
    const tomlSource = `
[database.credentials]
host = "db.internal"
username = "postgres"
auth_token = "secret-pass"
`;
    const tomlExtractor = new ConfigExtractor('secrets.toml', tomlSource);
    const tomlResult = tomlExtractor.extract();
    const tomlHost = tomlResult.nodes.find((n) => n.name === 'host');
    expect(tomlHost?.signature).toContain('[REDACTED]');
    expect(tomlHost?.signature).not.toContain('db.internal');

    const iniSource = `
[auth]
provider = "oauth2"
client_secret = "supersecret"
`;
    const iniExtractor = new ConfigExtractor('auth.ini', iniSource);
    const iniResult = iniExtractor.extract();
    const iniProv = iniResult.nodes.find((n) => n.name === 'provider');
    expect(iniProv?.signature).toContain('[REDACTED]');
    expect(iniProv?.signature).not.toContain('oauth2');
  });
});
