import { describe, it, expect } from 'vitest';
import { graphqlResolver, grpcResolver } from '../src/resolution/frameworks/api-contracts';
import { GraphQLExtractor } from '../src/extraction/graphql-extractor';
import { ProtobufExtractor } from '../src/extraction/protobuf-extractor';
import type { ResolutionContext, UnresolvedRef } from '../src/resolution/types';
import type { Node } from '../src/types';

describe('GraphQL Resolver & gRPC Implementation Linking (Audit Reconciliation)', () => {
  describe('GraphQL Linking', () => {
    it('extracts operations and emits references to schema fields and fragments', () => {
      const gqlSource = `
        type Query {
          getBook(id: ID!): Book
        }

        fragment BookDetail on Book {
          id
          title
        }

        query FetchBook {
          getBook(id: "123") {
            ...BookDetail
          }
        }
      `;

      const extractor = new GraphQLExtractor('api/schema.graphql', gqlSource);
      const result = extractor.extract();

      const opNode = result.nodes.find((n) => n.kind === 'function' && n.name === 'FetchBook');
      expect(opNode).toBeDefined();

      const fieldRef = result.unresolvedReferences.find((r) => r.referenceName === 'Query.getBook');
      expect(fieldRef).toBeDefined();

      const fragRef = result.unresolvedReferences.find((r) => r.referenceName === 'BookDetail');
      expect(fragRef).toBeDefined();
    });

    it('extracts explicit JS/TS resolver maps with Query/Mutation mappings', () => {
      const tsCode = `
        export const resolvers = {
          Query: {
            getBook: getBookById,
            listAuthors: fetchAuthors
          },
          Mutation: {
            createBook: handleCreateBook
          }
        };
      `;

      const extracted = graphqlResolver.extract!('src/resolvers.ts', tsCode);
      const refNames = extracted.references.map((r) => r.referenceName);

      expect(refNames).toContain('Query.getBook');
      expect(refNames).toContain('getBookById');
      expect(refNames).toContain('Query.listAuthors');
      expect(refNames).toContain('Mutation.createBook');
    });

    it('resolves explicit resolver maps to schema fields (positive explicit binding)', () => {
      const schemaFieldNode: Node = {
        id: 'node:api/schema.graphql:property:Query.getBook:5',
        kind: 'property',
        name: 'getBook',
        qualifiedName: 'api/schema.graphql#Query.getBook',
        filePath: 'api/schema.graphql',
        language: 'json',
        startLine: 5,
        endLine: 5,
        startColumn: 0,
        endColumn: 30,
        updatedAt: Date.now(),
      };

      const mockContext = {
        getAllFiles: () => ['api/schema.graphql', 'src/resolvers.ts'],
        getNodesByName: (name: string) => (name === 'getBook' ? [schemaFieldNode] : []),
      } as unknown as ResolutionContext;

      const ref: UnresolvedRef = {
        fromNodeId: 'src/resolvers.ts#Query.getBook:5',
        referenceName: 'Query.getBook',
        referenceKind: 'implements',
        line: 5,
        column: 0,
        filePath: 'src/resolvers.ts',
        language: 'typescript',
      };

      const resolved = graphqlResolver.resolve(ref, mockContext);
      expect(resolved).not.toBeNull();
      expect(resolved?.targetNodeId).toBe(schemaFieldNode.id);
      expect(resolved?.edgeKind).toBe('implements');
      expect(resolved?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('fails closed / returns null for ambiguous or missing GraphQL schema fields', () => {
      // 1. Missing field
      const emptyContext = {
        getAllFiles: () => ['api/schema.graphql'],
        getNodesByName: () => [],
      } as unknown as ResolutionContext;

      const missingRef: UnresolvedRef = {
        fromNodeId: 'src/resolvers.ts#line:10',
        referenceName: 'Query.nonExistentField',
        referenceKind: 'implements',
        line: 10,
        column: 0,
        filePath: 'src/resolvers.ts',
        language: 'typescript',
      };

      expect(graphqlResolver.resolve(missingRef, emptyContext)).toBeNull();

      // 2. Ambiguous fields in multiple schema files
      const nodeA: Node = {
        id: 'node:schema1.graphql:Query.getBook:1',
        kind: 'property',
        name: 'getBook',
        qualifiedName: 'schema1.graphql#Query.getBook',
        filePath: 'schema1.graphql',
        language: 'json',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 10,
        updatedAt: Date.now(),
      };
      const nodeB: Node = {
        id: 'node:schema2.graphql:Query.getBook:1',
        kind: 'property',
        name: 'getBook',
        qualifiedName: 'schema2.graphql#Query.getBook',
        filePath: 'schema2.graphql',
        language: 'json',
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 10,
        updatedAt: Date.now(),
      };

      const ambiguousContext = {
        getAllFiles: () => ['schema1.graphql', 'schema2.graphql'],
        getNodesByName: () => [nodeA, nodeB],
      } as unknown as ResolutionContext;

      expect(graphqlResolver.resolve(missingRef, ambiguousContext)).toBeNull();
    });

    it('rejects incorrect names (negative control)', () => {
      const mockContext = {
        getAllFiles: () => ['api/schema.graphql'],
        getNodesByName: () => [],
      } as unknown as ResolutionContext;

      const invalidRef: UnresolvedRef = {
        fromNodeId: 'src/resolvers.ts#line:1',
        referenceName: 'justAFunctionWithoutDot',
        referenceKind: 'implements',
        line: 1,
        column: 0,
        filePath: 'src/resolvers.ts',
        language: 'typescript',
      };

      expect(graphqlResolver.resolve(invalidRef, mockContext)).toBeNull();
    });
  });

  describe('gRPC Linking', () => {
    it('extracts gRPC implementation registrations across languages', () => {
      // 1. Node.js
      const jsCode = `
        server.addService(greeterProto.Greeter.service, {
          sayHello: handleSayHello,
          sayGoodbye: handleSayGoodbye
        });
      `;
      const jsExtracted = grpcResolver.extract!('server.js', jsCode);
      const jsRefNames = jsExtracted.references.map((r) => r.referenceName);
      expect(jsRefNames).toContain('Greeter.sayHello');
      expect(jsRefNames).toContain('handleSayHello');

      // 2. Python
      const pyCode = `
class GreeterServicer(helloworld_pb2_grpc.GreeterServicer):
    def SayHello(self, request, context):
        return helloworld_pb2.HelloReply(message='Hello')
      `;
      const pyExtracted = grpcResolver.extract!('greeter_server.py', pyCode);
      expect(pyExtracted.references.some((r) => r.referenceName === 'Greeter.SayHello')).toBe(true);

      // 3. Java
      const javaCode = `
        public class GreeterImpl extends GreeterGrpc.GreeterImplBase {
          public void sayHello(HelloRequest req, StreamObserver<HelloReply> resp) {
          }
        }
      `;
      const javaExtracted = grpcResolver.extract!('GreeterImpl.java', javaCode);
      expect(javaExtracted.references.some((r) => r.referenceName === 'Greeter.sayHello')).toBe(true);
    });

    it('resolves explicit gRPC implementation to .proto rpc method (positive explicit binding)', () => {
      const protoMethodNode: Node = {
        id: 'node:proto/greeter.proto:method:Greeter.SayHello:15',
        kind: 'method',
        name: 'SayHello',
        qualifiedName: 'proto/greeter.proto#helloworld.Greeter.SayHello',
        filePath: 'proto/greeter.proto',
        language: 'properties',
        startLine: 15,
        endLine: 15,
        startColumn: 0,
        endColumn: 50,
        updatedAt: Date.now(),
      };

      const mockContext = {
        getAllFiles: () => ['proto/greeter.proto', 'server.py'],
        getNodesByName: (name: string) => (name === 'SayHello' ? [protoMethodNode] : []),
      } as unknown as ResolutionContext;

      const ref: UnresolvedRef = {
        fromNodeId: 'server.py#Greeter.SayHello:5',
        referenceName: 'Greeter.SayHello',
        referenceKind: 'implements',
        line: 5,
        column: 0,
        filePath: 'server.py',
        language: 'python',
      };

      const resolved = grpcResolver.resolve(ref, mockContext);
      expect(resolved).not.toBeNull();
      expect(resolved?.targetNodeId).toBe(protoMethodNode.id);
      expect(resolved?.edgeKind).toBe('implements');
      expect(resolved?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('fails closed on ambiguous or missing gRPC declarations', () => {
      // 1. Missing
      const emptyContext = {
        getAllFiles: () => ['proto/greeter.proto'],
        getNodesByName: () => [],
      } as unknown as ResolutionContext;

      const missingRef: UnresolvedRef = {
        fromNodeId: 'server.py#Greeter.MissingRpc:5',
        referenceName: 'Greeter.MissingRpc',
        referenceKind: 'implements',
        line: 5,
        column: 0,
        filePath: 'server.py',
        language: 'python',
      };

      expect(grpcResolver.resolve(missingRef, emptyContext)).toBeNull();

      // 2. Ambiguous methods across services
      const methodA: Node = {
        id: 'node:proto/a.proto:method:Greeter.SayHello:10',
        kind: 'method',
        name: 'SayHello',
        qualifiedName: 'proto/a.proto#pkgA.Greeter.SayHello',
        filePath: 'proto/a.proto',
        language: 'properties',
        startLine: 10,
        endLine: 10,
        startColumn: 0,
        endColumn: 20,
        updatedAt: Date.now(),
      };
      const methodB: Node = {
        id: 'node:proto/b.proto:method:Greeter.SayHello:10',
        kind: 'method',
        name: 'SayHello',
        qualifiedName: 'proto/b.proto#pkgB.Greeter.SayHello',
        filePath: 'proto/b.proto',
        language: 'properties',
        startLine: 10,
        endLine: 10,
        startColumn: 0,
        endColumn: 20,
        updatedAt: Date.now(),
      };

      const ambiguousContext = {
        getAllFiles: () => ['proto/a.proto', 'proto/b.proto'],
        getNodesByName: () => [methodA, methodB],
      } as unknown as ResolutionContext;

      expect(grpcResolver.resolve(missingRef, ambiguousContext)).toBeNull();
    });
  });
});
