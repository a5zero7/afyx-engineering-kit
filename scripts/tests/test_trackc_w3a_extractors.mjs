import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyEntityDomain,
  getEntityTaxonomy,
  validateEntityTaxonomy,
} from '../../afyx-graph/engine/src/extraction/taxonomy.ts';
import {
  BuildExtractor,
  isBuildFile,
} from '../../afyx-graph/engine/src/extraction/build-extractor.ts';
import {
  AnsibleExtractor,
  isAnsibleFile,
} from '../../afyx-graph/engine/src/extraction/ansible-extractor.ts';
import {
  SchemaExtractor,
  isSchemaFile,
} from '../../afyx-graph/engine/src/extraction/schema-extractor.ts';
import { extractFromSource } from '../../afyx-graph/engine/src/extraction/extract.ts';

describe('Track C Wave 3A Extractors & Taxonomy Unit Tests', () => {

  describe('Taxonomy Classification (AFYX-203 / C0.1)', () => {
    it('classifies all 7 canonical engineering domains correctly', () => {
      // 1. Code domain
      const codeNode = {
        filePath: 'src/utils/math.ts',
        language: 'typescript',
        kind: 'function',
        name: 'add',
        qualifiedName: 'src/utils/math.ts::add',
      };
      assert.equal(classifyEntityDomain(codeNode), 'code');

      // 2. Runtime / Shell domain
      const shellNode = {
        filePath: 'scripts/deploy.sh',
        language: 'shell',
        kind: 'function',
        name: 'deploy_all',
        qualifiedName: 'scripts/deploy.sh::deploy_all',
      };
      assert.equal(classifyEntityDomain(shellNode), 'runtime_shell');

      // 3. Build domain
      const buildNode = {
        filePath: 'Makefile',
        language: 'properties',
        kind: 'function',
        name: 'build',
        qualifiedName: 'Makefile::build',
      };
      assert.equal(classifyEntityDomain(buildNode), 'build');

      // 4. Infrastructure / Containers domain
      const dockerNode = {
        filePath: 'Dockerfile',
        language: 'yaml',
        kind: 'module',
        name: 'app-image',
        qualifiedName: 'Dockerfile::base',
      };
      assert.equal(classifyEntityDomain(dockerNode), 'infrastructure_containers');

      const ansibleNode = {
        filePath: 'playbooks/site.yml',
        language: 'yaml',
        kind: 'function',
        name: 'Install Nginx',
        qualifiedName: 'playbooks/site.yml::task.Install Nginx',
      };
      assert.equal(classifyEntityDomain(ansibleNode), 'infrastructure_containers');

      // 5. Data / Database domain
      const sqlNode = {
        filePath: 'migrations/001_create_users.sql',
        language: 'sql',
        kind: 'class',
        name: 'users',
        qualifiedName: 'sql::table::users',
      };
      assert.equal(classifyEntityDomain(sqlNode), 'data_database');

      // 6. API / Schema domain
      const schemaNode = {
        filePath: 'schemas/user.schema.json',
        language: 'json',
        kind: 'type_alias',
        name: 'User',
        qualifiedName: 'schemas/user.schema.json::$defs.User',
      };
      assert.equal(classifyEntityDomain(schemaNode), 'api_schema');

      const avroNode = {
        filePath: 'avro/user_event.avsc',
        language: 'json',
        kind: 'class',
        name: 'UserEvent',
        qualifiedName: 'avro/user_event.avsc::UserEvent',
      };
      assert.equal(classifyEntityDomain(avroNode), 'api_schema');

      // 7. Framework domain
      const routeNode = {
        filePath: 'src/routes/api.ts',
        language: 'typescript',
        kind: 'route',
        name: '/api/v1/users',
        qualifiedName: 'src/routes/api.ts::route::/api/v1/users',
      };
      assert.equal(classifyEntityDomain(routeNode), 'framework');
    });

    it('generates full taxonomy metadata and validates correctly', () => {
      const node = {
        id: 'node-1',
        filePath: 'Makefile',
        language: 'properties',
        kind: 'function',
        name: 'compile',
        qualifiedName: 'Makefile::compile',
        startLine: 1,
        endLine: 5,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      };
      const tax = getEntityTaxonomy(node);
      assert.equal(tax.domain, 'build');
      assert.ok(tax.provenance.includes('Makefile'));
      assert.equal(tax.confidence, 1.0);
      assert.ok(validateEntityTaxonomy(tax));
    });
  });

  describe('Build Extractor (AFYX-206 / C1.2)', () => {
    it('detects and extracts Makefile targets and dependencies', () => {
      assert.ok(isBuildFile('Makefile'));
      assert.ok(isBuildFile('sub/GNUmakefile'));

      const makeSource = [
        'all: build test',
        '',
        'build: src/main.c',
        '\tgcc -o app src/main.c',
        '',
        'test: build',
        '\t./app --test',
        '',
        'clean:',
        '\trm -f app',
      ].join('\n');

      const result = new BuildExtractor('Makefile', makeSource).extract();
      assert.equal(result.errors.length, 0);
      assert.ok(result.nodes.length >= 4);

      const targetNames = result.nodes.map(n => n.name);
      assert.ok(targetNames.includes('all'));
      assert.ok(targetNames.includes('build'));
      assert.ok(targetNames.includes('test'));
      assert.ok(targetNames.includes('clean'));

      // Check dependency edges
      assert.ok(result.edges.length > 0);
    });

    it('detects and extracts package.json scripts and dependencies', () => {
      assert.ok(isBuildFile('package.json'));

      const pkgSource = JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        scripts: {
          build: 'tsc -p .',
          test: 'vitest run',
        },
        dependencies: {
          express: '^4.19.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      }, null, 2);

      const result = new BuildExtractor('package.json', pkgSource).extract();
      assert.equal(result.errors.length, 0);

      const names = result.nodes.map(n => n.name);
      assert.ok(names.includes('build'));
      assert.ok(names.includes('test'));
      assert.ok(names.includes('express'));
      assert.ok(names.includes('typescript'));
    });

    it('detects and extracts CMakeLists.txt targets', () => {
      assert.ok(isBuildFile('CMakeLists.txt'));

      const cmakeSource = [
        'cmake_minimum_required(VERSION 3.20)',
        'project(MyEngine)',
        'add_executable(my_engine src/main.cpp src/engine.cpp)',
        'add_library(engine_core STATIC src/core.cpp)',
        'target_link_libraries(my_engine PRIVATE engine_core)',
      ].join('\n');

      const result = new BuildExtractor('CMakeLists.txt', cmakeSource).extract();
      assert.equal(result.errors.length, 0);

      const names = result.nodes.map(n => n.name);
      assert.ok(names.includes('my_engine'));
      assert.ok(names.includes('engine_core'));
    });
  });

  describe('Ansible Extractor (AFYX-213 / C2.3)', () => {
    it('detects and extracts Ansible playbook, plays, and tasks', () => {
      assert.ok(isAnsibleFile('playbooks/site.yml'));
      assert.ok(isAnsibleFile('roles/web/tasks/main.yml'));

      const playbookSource = [
        '- name: Configure Webservers',
        '  hosts: webservers',
        '  become: yes',
        '  tasks:',
        '    - name: Install nginx',
        '      apt:',
        '        name: nginx',
        '        state: present',
        '    - name: Start nginx service',
        '      service:',
        '        name: nginx',
        '        state: started',
        '  handlers:',
        '    - name: restart nginx',
        '      service:',
        '        name: nginx',
        '        state: restarted',
      ].join('\n');

      const result = new AnsibleExtractor('playbooks/site.yml', playbookSource).extract();
      assert.equal(result.errors.length, 0);

      const taskNames = result.nodes.map(n => n.name);
      assert.ok(taskNames.includes('Configure Webservers'));
      assert.ok(taskNames.includes('Install nginx'));
      assert.ok(taskNames.includes('Start nginx service'));
      assert.ok(taskNames.includes('restart nginx'));
    });

    it('masks Ansible Vault secrets fail-closed', () => {
      const vaultSource = [
        '- name: Vault Task',
        '  hosts: localhost',
        '  vars:',
        '    api_secret: !vault |',
        '      $ANSIBLE_VAULT;1.1;AES256',
        '      31323334353637383930',
        '  tasks:',
        '    - name: Show secret',
        '      debug:',
        '        msg: "masked"',
      ].join('\n');

      const result = new AnsibleExtractor('playbooks/vault.yml', vaultSource).extract();
      assert.equal(result.errors.length, 0);
      assert.ok(!JSON.stringify(result.nodes).includes('$ANSIBLE_VAULT;1.1;AES256'));
    });
  });

  describe('Schema Extractor (AFYX-217 / C3.4)', () => {
    it('detects and extracts JSON Schema with $defs and local $ref', () => {
      assert.ok(isSchemaFile('schemas/user.schema.json'));

      const jsonSchemaSource = JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'UserCatalog',
        $defs: {
          Address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { type: 'string' },
            },
          },
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              address: { $ref: '#/$defs/Address' },
              apiKey: { type: 'string', default: 'sk_live_12345' },
            },
          },
        },
      }, null, 2);

      const result = new SchemaExtractor('schemas/user.schema.json', jsonSchemaSource).extract();
      assert.equal(result.errors.length, 0);

      const names = result.nodes.map(n => n.name);
      assert.ok(names.includes('UserCatalog'));
      assert.ok(names.includes('Address'));
      assert.ok(names.includes('User'));
      assert.ok(names.includes('street'));
      assert.ok(names.includes('address'));
      assert.ok(names.includes('apiKey'));

      // Check secret redaction on apiKey default
      const apiKeyNode = result.nodes.find(n => n.name === 'apiKey');
      assert.ok(apiKeyNode);
      assert.ok(apiKeyNode.docstring && apiKeyNode.docstring.includes('[REDACTED SECRET DEFAULT]'));

      // Check $ref edge from address -> Address
      const addressNode = result.nodes.find(n => n.name === 'address');
      const addressDefNode = result.nodes.find(n => n.name === 'Address');
      const hasRefEdge = result.edges.some(e => e.source === addressNode.id && e.target === addressDefNode.id && e.kind === 'references');
      assert.ok(hasRefEdge);
    });

    it('detects and extracts AsyncAPI channels, operations, and messages', () => {
      assert.ok(isSchemaFile('asyncapi.yaml'));

      const asyncApiSource = [
        'asyncapi: "2.6.0"',
        'info:',
        '  title: NotificationService',
        '  version: "1.0.0"',
        'channels:',
        '  user/signup:',
        '    publish:',
        '      operationId: onUserSignup',
        '      message:',
        '        name: UserSignupEvent',
        '  email/send:',
        '    subscribe:',
        '      operationId: sendEmail',
      ].join('\n');

      const result = new SchemaExtractor('asyncapi.yaml', asyncApiSource).extract();
      assert.equal(result.errors.length, 0);

      const names = result.nodes.map(n => n.name);
      assert.ok(names.includes('NotificationService'));
      assert.ok(names.includes('user/signup'));
      assert.ok(names.includes('onUserSignup'));
      assert.ok(names.includes('email/send'));
      assert.ok(names.includes('sendEmail'));
    });

    it('detects and extracts Apache Avro schemas (.avsc)', () => {
      assert.ok(isSchemaFile('schemas/order.avsc'));

      const avroSource = JSON.stringify({
        type: 'record',
        name: 'OrderEvent',
        namespace: 'com.afyx.orders',
        doc: 'Order event record',
        fields: [
          { name: 'orderId', type: 'string' },
          { name: 'amount', type: 'double' },
          { name: 'status', type: 'string' },
        ],
      }, null, 2);

      const result = new SchemaExtractor('schemas/order.avsc', avroSource).extract();
      assert.equal(result.errors.length, 0);

      const recordNode = result.nodes.find(n => n.name === 'OrderEvent');
      assert.ok(recordNode);
      assert.equal(recordNode.kind, 'class');

      const fieldNames = result.nodes.filter(n => n.kind === 'field').map(n => n.name);
      assert.ok(fieldNames.includes('orderId'));
      assert.ok(fieldNames.includes('amount'));
      assert.ok(fieldNames.includes('status'));
    });
  });

  describe('Integration with extractFromSource', () => {
    it('routes build, ansible, and schema files via extractFromSource', () => {
      const bRes = extractFromSource('Makefile', 'all:\n\techo "hi"\n');
      assert.ok(bRes.nodes.some(n => n.name === 'all'));

      const aRes = extractFromSource('playbooks/deploy.yml', '- hosts: all\n  tasks:\n    - name: Ping\n      ping:\n');
      assert.ok(aRes.nodes.some(n => n.name === 'Ping'));

      const sRes = extractFromSource('schemas/event.avsc', JSON.stringify({ type: 'record', name: 'Evt', fields: [] }));
      assert.ok(sRes.nodes.some(n => n.name === 'Evt'));
    });
  });
});
