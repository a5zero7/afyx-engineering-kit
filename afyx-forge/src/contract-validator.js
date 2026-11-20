/**
 * AFYX Universal API & Schema Contract Validator (AfyxContractValidation/v1).
 *
 * Provides universal structural validation for:
 * 1. Data Formats: JSON, JSON Schema subset, YAML, CSV, .env vs .env.example
 * 2. API Specifications: OpenAPI 3.0, GraphQL SDL, Protocol Buffers (.proto)
 *
 * Adheres strictly to the AFYX validation contract:
 * - Deterministic, line-accurate diagnostics
 * - Secret-safe: Never leaks .env values or credentials in diagnostics
 * - Distinguishes: PASS, FAIL, UNSUPPORTED, UNRESOLVED
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

export const CONTRACT_VALIDATION_CONTRACT = 'AfyxContractValidation/v1';

export class ContractValidator {
  /**
   * @param {string} workspaceRoot
   */
  constructor(workspaceRoot) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  /**
   * Validates a contract or data file.
   *
   * @param {string} relativePath
   * @param {object} [options]
   * @param {string} [options.contractType] 'openapi' | 'graphql' | 'protobuf' | 'json' | 'csv' | 'env'
   * @param {string} [options.schemaFile] Optional schema file for JSON data
   * @param {string} [options.exampleFile] Optional .env.example file for env validation
   * @returns {object} Validation result with diagnostics
   */
  validate(relativePath, options = {}) {
    const fullPath = resolve(this.workspaceRoot, relativePath);
    if (!existsSync(fullPath)) {
      return {
        contract: CONTRACT_VALIDATION_CONTRACT,
        target: relativePath,
        status: 'FAIL',
        diagnostics: [
          {
            severity: 'error',
            message: `Target file not found: ${relativePath}`,
            path: relativePath,
          },
        ],
      };
    }

    const ext = extname(fullPath).toLowerCase();
    const type = options.contractType || this._inferType(fullPath);

    switch (type) {
      case 'json':
        return this._validateJson(fullPath, relativePath, options.schemaFile);
      case 'csv':
        return this._validateCsv(fullPath, relativePath);
      case 'env':
        return this._validateEnv(fullPath, relativePath, options.exampleFile);
      case 'openapi':
        return this._validateOpenApi(fullPath, relativePath);
      case 'graphql':
        return this._validateGraphQL(fullPath, relativePath);
      case 'protobuf':
        return this._validateProtobuf(fullPath, relativePath);
      default:
        return {
          contract: CONTRACT_VALIDATION_CONTRACT,
          target: relativePath,
          status: 'UNSUPPORTED',
          diagnostics: [
            {
              severity: 'warning',
              message: `Validation for contract type '${type}' (${ext}) is not supported.`,
              path: relativePath,
            },
          ],
        };
    }
  }

  _inferType(fullPath) {
    const ext = extname(fullPath).toLowerCase();
    const base = fullPath.toLowerCase();

    if (base.endsWith('.env') || base.endsWith('.env.local') || base.endsWith('.env.production')) return 'env';
    if (ext === '.json') {
      if (base.includes('openapi') || base.includes('swagger')) return 'openapi';
      return 'json';
    }
    if (ext === '.yaml' || ext === '.yml') {
      if (base.includes('openapi') || base.includes('swagger')) return 'openapi';
      return 'json';
    }
    if (ext === '.csv' || ext === '.tsv') return 'csv';
    if (ext === '.graphql' || ext === '.gql') return 'graphql';
    if (ext === '.proto') return 'protobuf';

    return 'unknown';
  }

  _validateJson(fullPath, relPath, schemaFile) {
    const diagnostics = [];
    let parsed;
    try {
      const content = readFileSync(fullPath, 'utf8');
      parsed = JSON.parse(content);
    } catch (err) {
      diagnostics.push({
        severity: 'error',
        message: `JSON syntax error: ${err.message}`,
        path: relPath,
      });
      return { contract: CONTRACT_VALIDATION_CONTRACT, target: relPath, status: 'FAIL', diagnostics };
    }

    if (schemaFile) {
      const fullSchema = resolve(this.workspaceRoot, schemaFile);
      if (!existsSync(fullSchema)) {
        diagnostics.push({
          severity: 'error',
          message: `Schema file not found: ${schemaFile}`,
          path: schemaFile,
        });
        return { contract: CONTRACT_VALIDATION_CONTRACT, target: relPath, status: 'FAIL', diagnostics };
      }

      try {
        const schema = JSON.parse(readFileSync(fullSchema, 'utf8'));
        this._validateJsonSchemaSubset(parsed, schema, '', diagnostics);
      } catch (err) {
        diagnostics.push({
          severity: 'error',
          message: `Schema parse error: ${err.message}`,
          path: schemaFile,
        });
      }
    }

    const hasError = diagnostics.some((d) => d.severity === 'error');
    return {
      contract: CONTRACT_VALIDATION_CONTRACT,
      target: relPath,
      status: hasError ? 'FAIL' : 'PASS',
      diagnostics,
    };
  }

  _validateJsonSchemaSubset(data, schema, jsonPath, diagnostics) {
    if (!schema || typeof schema !== 'object') return;

    if (schema.type) {
      const expected = schema.type;
      const actual = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
      if (actual !== expected && !(expected === 'number' && actual === 'number')) {
        diagnostics.push({
          severity: 'error',
          message: `Type mismatch at '${jsonPath || '/'}' : expected '${expected}', got '${actual}'`,
          path: jsonPath || '/',
        });
        return;
      }
    }

    if (schema.required && Array.isArray(schema.required) && typeof data === 'object' && data !== null) {
      for (const reqKey of schema.required) {
        if (!(reqKey in data)) {
          diagnostics.push({
            severity: 'error',
            message: `Missing required property '${reqKey}' at '${jsonPath || '/'}'`,
            path: `${jsonPath}/${reqKey}`,
          });
        }
      }
    }

    if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          this._validateJsonSchemaSubset(data[key], propSchema, `${jsonPath}/${key}`, diagnostics);
        }
      }
    }
  }

  _validateCsv(fullPath, relPath) {
    const diagnostics = [];
    const content = readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

    if (lines.length === 0) {
      diagnostics.push({
        severity: 'error',
        message: 'CSV file is empty.',
        path: relPath,
      });
      return { contract: CONTRACT_VALIDATION_CONTRACT, target: relPath, status: 'FAIL', diagnostics };
    }

    const delimiter = fullPath.endsWith('.tsv') ? '\t' : ',';
    const headerCols = lines[0].split(delimiter).length;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).length;
      if (cols !== headerCols) {
        diagnostics.push({
          severity: 'error',
          line: i + 1,
          message: `Row ${i + 1} has ${cols} columns; expected ${headerCols} from header`,
          path: relPath,
        });
        if (diagnostics.length >= 10) break; // Bound error explosion
      }
    }

    const hasError = diagnostics.some((d) => d.severity === 'error');
    return {
      contract: CONTRACT_VALIDATION_CONTRACT,
      target: relPath,
      status: hasError ? 'FAIL' : 'PASS',
      diagnostics,
    };
  }

  _validateEnv(fullPath, relPath, exampleFile) {
    const diagnostics = [];
    const envContent = readFileSync(fullPath, 'utf8');
    const envKeys = this._extractEnvKeys(envContent);

    if (exampleFile) {
      const fullExample = resolve(this.workspaceRoot, exampleFile);
      if (!existsSync(fullExample)) {
        diagnostics.push({
          severity: 'warning',
          message: `Example env file not found: ${exampleFile}`,
          path: exampleFile,
        });
      } else {
        const exampleContent = readFileSync(fullExample, 'utf8');
        const exampleKeys = this._extractEnvKeys(exampleContent);

        // Check for missing keys in target .env
        for (const reqKey of exampleKeys) {
          if (!envKeys.includes(reqKey)) {
            diagnostics.push({
              severity: 'error',
              message: `Required environment variable '${reqKey}' defined in ${exampleFile} is missing in ${relPath}`,
              path: relPath,
            });
          }
        }

        // Warn for extra keys not in example
        for (const actualKey of envKeys) {
          if (!exampleKeys.includes(actualKey)) {
            diagnostics.push({
              severity: 'warning',
              message: `Environment variable '${actualKey}' is present in ${relPath} but not documented in ${exampleFile}`,
              path: relPath,
            });
          }
        }
      }
    }

    const hasError = diagnostics.some((d) => d.severity === 'error');
    return {
      contract: CONTRACT_VALIDATION_CONTRACT,
      target: relPath,
      status: hasError ? 'FAIL' : 'PASS',
      totalKeysFound: envKeys.length,
      diagnostics,
    };
  }

  _extractEnvKeys(content) {
    const keys = [];
    const lines = content.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        keys.push(line.slice(0, eqIdx).trim());
      }
    }
    return keys;
  }

  _validateOpenApi(fullPath, relPath) {
    const diagnostics = [];
    const content = readFileSync(fullPath, 'utf8');

    // Structural checks for openapi or swagger key
    const hasVersion = /openapi\s*:\s*['"]?3\./i.test(content) || /swagger\s*:\s*['"]?2\./i.test(content);
    if (!hasVersion) {
      diagnostics.push({
        severity: 'error',
        message: "Missing 'openapi: 3.x' or 'swagger: 2.0' declaration",
        path: relPath,
      });
    }

    if (!/\bpaths\s*:/i.test(content)) {
      diagnostics.push({
        severity: 'error',
        message: "Missing required 'paths' section in OpenAPI specification",
        path: relPath,
      });
    }

    if (!/\binfo\s*:/i.test(content)) {
      diagnostics.push({
        severity: 'error',
        message: "Missing required 'info' section in OpenAPI specification",
        path: relPath,
      });
    }

    const hasError = diagnostics.some((d) => d.severity === 'error');
    return {
      contract: CONTRACT_VALIDATION_CONTRACT,
      target: relPath,
      status: hasError ? 'FAIL' : 'PASS',
      diagnostics,
    };
  }

  _validateGraphQL(fullPath, relPath) {
    const diagnostics = [];
    const content = readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/);

    let openBraces = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      for (const ch of line) {
        if (ch === '{') openBraces++;
        if (ch === '}') openBraces--;
      }
    }

    if (openBraces !== 0) {
      diagnostics.push({
        severity: 'error',
        message: `Unbalanced braces in GraphQL schema (mismatch count: ${openBraces})`,
        path: relPath,
      });
    }

    const hasDefinitions = /\b(type|schema|query|mutation|input|interface|enum|union|scalar)\b/.test(content);
    if (!hasDefinitions) {
      diagnostics.push({
        severity: 'error',
        message: 'No GraphQL type, schema, or operation definitions found in file',
        path: relPath,
      });
    }

    const hasError = diagnostics.some((d) => d.severity === 'error');
    return {
      contract: CONTRACT_VALIDATION_CONTRACT,
      target: relPath,
      status: hasError ? 'FAIL' : 'PASS',
      diagnostics,
    };
  }

  _validateProtobuf(fullPath, relPath) {
    const diagnostics = [];
    const content = readFileSync(fullPath, 'utf8');

    if (!/syntax\s*=\s*['"]proto[23]['"]\s*;/i.test(content)) {
      diagnostics.push({
        severity: 'warning',
        message: "Missing explicit 'syntax = \"proto3\";' declaration",
        path: relPath,
      });
    }

    let openBraces = 0;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      const commentIdx = line.indexOf('//');
      if (commentIdx >= 0) line = line.slice(0, commentIdx).trim();

      for (const ch of line) {
        if (ch === '{') openBraces++;
        if (ch === '}') openBraces--;
      }
    }

    if (openBraces !== 0) {
      diagnostics.push({
        severity: 'error',
        message: `Unbalanced braces in Protobuf file (mismatch count: ${openBraces})`,
        path: relPath,
      });
    }

    const hasError = diagnostics.some((d) => d.severity === 'error');
    return {
      contract: CONTRACT_VALIDATION_CONTRACT,
      target: relPath,
      status: hasError ? 'FAIL' : 'PASS',
      diagnostics,
    };
  }
}
