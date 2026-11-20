import { describe, it, expect } from 'vitest';
import { GraphQLExtractor, isGraphQLFile } from '../src/extraction/graphql-extractor';

describe('AFYX-215: GraphQL Intelligence Extractor', () => {
  it('correctly identifies GraphQL files', () => {
    expect(isGraphQLFile('schema.graphql')).toBe(true);
    expect(isGraphQLFile('queries.gql')).toBe(true);
    expect(isGraphQLFile('schema.json')).toBe(false);
    expect(isGraphQLFile('main.ts')).toBe(false);
  });

  it('extracts GraphQL SDL types, fields, enums, unions, and interfaces with references', () => {
    const schema = `
# Core Schema Types
interface Node {
  id: ID!
}

enum Role {
  ADMIN
  USER
  GUEST
}

type User implements Node {
  id: ID!
  name: String!
  role: Role!
  posts: [Post!]!
}

type Post implements Node {
  id: ID!
  title: String!
  author: User!
}

union SearchItem = User | Post

input CreateUserInput {
  name: String!
  role: Role
}

scalar DateTime
`;

    const extractor = new GraphQLExtractor('schema.graphql', schema);
    const result = extractor.extract();

    expect(result.errors).toHaveLength(0);

    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('Node');
    expect(names).toContain('Role');
    expect(names).toContain('User');
    expect(names).toContain('Post');
    expect(names).toContain('SearchItem');
    expect(names).toContain('CreateUserInput');
    expect(names).toContain('DateTime');

    // Check enum values
    expect(names).toContain('ADMIN');
    expect(names).toContain('USER');

    // Check fields
    expect(names).toContain('title');
    expect(names).toContain('author');

    // Interface implementation reference
    const userImplementsNode = result.unresolvedReferences.find(
      (r) => r.referenceName === 'Node'
    );
    expect(userImplementsNode).toBeDefined();

    // Field type references
    const postAuthorRef = result.unresolvedReferences.find(
      (r) => r.referenceName === 'User'
    );
    expect(postAuthorRef).toBeDefined();

    const userPostsRef = result.unresolvedReferences.find(
      (r) => r.referenceName === 'Post'
    );
    expect(userPostsRef).toBeDefined();

    // Union member references
    const unionUserRef = result.unresolvedReferences.find(
      (r) => r.referenceName === 'User'
    );
    expect(unionUserRef).toBeDefined();
  });

  it('extracts operations and fragments', () => {
    const doc = `
fragment UserSummary on User {
  id
  name
}

query GetUserProfile {
  currentUser {
    ...UserSummary
  }
}

mutation RegisterUser {
  createUser(input: { name: "Bob" }) {
    id
  }
}
`;

    const extractor = new GraphQLExtractor('queries.gql', doc);
    const result = extractor.extract();

    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('UserSummary');
    expect(names).toContain('GetUserProfile');
    expect(names).toContain('RegisterUser');

    // Fragment target type reference
    const fragRef = result.unresolvedReferences.find(
      (r) => r.referenceName === 'User'
    );
    expect(fragRef).toBeDefined();
  });
});
