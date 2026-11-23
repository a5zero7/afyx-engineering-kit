import { describe, it, expect } from 'vitest';
import { OpenApiExtractor, isOpenApiFile } from '../src/extraction/openapi-extractor';

describe('AFYX-214: OpenAPI Schema & Endpoint Intelligence Extractor', () => {
  it('identifies OpenAPI and Swagger files correctly', () => {
    expect(isOpenApiFile('openapi.json')).toBe(true);
    expect(isOpenApiFile('openapi.yaml')).toBe(true);
    expect(isOpenApiFile('swagger.json')).toBe(true);
    expect(isOpenApiFile('swagger.yaml')).toBe(true);
    expect(isOpenApiFile('docs/api/openapi.yml')).toBe(true);
    expect(isOpenApiFile('custom.json', '{"openapi": "3.0.1", "info": {}}')).toBe(true);

    // Negative tests
    expect(isOpenApiFile('package.json', '{"name": "test"}')).toBe(false);
    expect(isOpenApiFile('docker-compose.yml')).toBe(false);
  });

  it('extracts OpenAPI 3.x routes, operations, parameters, schemas, and $ref references (YAML)', () => {
    const openapiYaml = `
openapi: 3.0.3
info:
  title: Petstore API
  version: 1.0.0
  description: Sample Petstore OpenAPI spec

paths:
  /pets:
    get:
      summary: List all pets
      operationId: listPets
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
      responses:
        '200':
          description: A paged array of pets
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Pet'
    post:
      summary: Create a pet
      operationId: createPets
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/NewPet'
      responses:
        '201':
          description: Null response

components:
  schemas:
    Pet:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: integer
          format: int64
        name:
          type: string
        tag:
          type: string

    NewPet:
      type: object
      required:
        - name
      properties:
        name:
          type: string
        tag:
          type: string
`;

    const extractor = new OpenApiExtractor('openapi.yaml', openapiYaml);
    const result = extractor.extract();

    expect(result.errors).toHaveLength(0);

    // Root node
    const rootNode = result.nodes.find((n) => n.kind === 'module');
    expect(rootNode).toBeDefined();
    expect(rootNode?.name).toBe('Petstore API');

    // Route node
    const routeNode = result.nodes.find((n) => n.kind === 'route');
    expect(routeNode).toBeDefined();
    expect(routeNode?.name).toBe('/pets');

    // Operations
    const opNodes = result.nodes.filter((n) => n.kind === 'function');
    const opNames = opNodes.map((n) => n.name);
    expect(opNames).toContain('listPets');
    expect(opNames).toContain('createPets');

    // Parameter
    const paramNode = result.nodes.find((n) => n.kind === 'parameter' && n.name === 'limit');
    expect(paramNode).toBeDefined();

    // Schemas
    const schemaNodes = result.nodes.filter((n) => n.kind === 'type_alias');
    const schemaNames = schemaNodes.map((n) => n.name);
    expect(schemaNames).toContain('Pet');
    expect(schemaNames).toContain('NewPet');

    // Schema fields
    const fieldNodes = result.nodes.filter((n) => n.kind === 'field');
    const fieldNames = fieldNodes.map((n) => n.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('tag');

    // $ref reference edges
    const petSchema = schemaNodes.find((n) => n.name === 'Pet');
    const listPetsOp = opNodes.find((n) => n.name === 'listPets');
    expect(petSchema).toBeDefined();
    expect(listPetsOp).toBeDefined();

    const refEdge = result.edges.find(
      (e) => e.source === listPetsOp?.id && e.target === petSchema?.id && e.kind === 'references'
    );
    expect(refEdge).toBeDefined();
  });

  it('extracts Swagger 2.0 definitions and operations in JSON format', () => {
    const swaggerJson = JSON.stringify({
      swagger: '2.0',
      info: {
        title: 'User API',
        version: '2.0.0',
      },
      paths: {
        '/users/{userId}': {
          get: {
            operationId: 'getUserById',
            parameters: [
              {
                name: 'userId',
                in: 'path',
                required: true,
                type: 'integer',
              },
            ],
            responses: {
              '200': {
                description: 'User details',
                schema: {
                  $ref: '#/definitions/User',
                },
              },
            },
          },
        },
      },
      definitions: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string' },
          },
        },
      },
    });

    const extractor = new OpenApiExtractor('swagger.json', swaggerJson);
    const result = extractor.extract();

    expect(result.errors).toHaveLength(0);

    const userSchema = result.nodes.find((n) => n.kind === 'type_alias' && n.name === 'User');
    expect(userSchema).toBeDefined();

    const opNode = result.nodes.find((n) => n.kind === 'function' && n.name === 'getUserById');
    expect(opNode).toBeDefined();

    const refEdge = result.edges.find(
      (e) => e.source === opNode?.id && e.target === userSchema?.id && e.kind === 'references'
    );
    expect(refEdge).toBeDefined();
  });

  it('handles recursive/circular schema definitions safely', () => {
    const recursiveYaml = `
openapi: 3.0.0
info:
  title: Graph Node API
  version: 1.0.0
paths: {}
components:
  schemas:
    TreeNode:
      type: object
      properties:
        value:
          type: string
        parent:
          $ref: '#/components/schemas/TreeNode'
        children:
          type: array
          items:
            $ref: '#/components/schemas/TreeNode'
`;

    const extractor = new OpenApiExtractor('tree.yaml', recursiveYaml);
    const result = extractor.extract();

    const treeNode = result.nodes.find((n) => n.kind === 'type_alias' && n.name === 'TreeNode');
    expect(treeNode).toBeDefined();

    // Verify references to self do not cause callstack overflow
    const selfRefs = result.edges.filter(
      (e) => e.target === treeNode?.id && e.kind === 'references'
    );
    expect(selfRefs.length).toBeGreaterThan(0);
  });
});
