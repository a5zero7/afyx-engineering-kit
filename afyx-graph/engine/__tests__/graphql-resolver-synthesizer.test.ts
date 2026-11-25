import { expect, it } from 'vitest';
import { schemaFixture } from './schema-dispatch-fixture';

const schema = `
type Query {
  getUser: User
  namedUser: User
  typedUser: User
  pythonUser: User
  strawberryUser: User
  goUser: User
  list: [User]
}
type Mutation {
  createUser: User
  pythonCreate: User
  goCreate: User
}
type Subscription {
  memberJoined: User
}
type User {
  displayName: String
  unrelated: String
}
`;

it('links SDL fields to explicit JavaScript, TypeScript, Python and Go resolver bindings', async () => {
  await schemaFixture({
    'schema.graphql': schema,
    'storage.ts': 'export function findUser() { return 1; }',
    'map.ts': `
import { findUser as lookup } from './storage';
function databaseUser() { return lookup(); }
const resolvers = {
  Query: { getUser() { return databaseUser(); } },
  Mutation: { createUser: lookup },
};
`,
    'names.js': `
function onJoin() { return null; }
const resolvers = { Subscription: { memberJoined: onJoin } };
`,
    'decorators.ts': `
@Resolver(() => User)
class UserResolver {
  @Query('namedUser')
  fetch() { return null; }

  @Query(() => User)
  typedUser() { return null; }

  @ResolveField('displayName')
  render() { return ''; }
}

class Unrelated {
  @ResolveField('unrelated')
  render() { return ''; }
  list() { return []; }
}

// const resolvers = { Query: { list: list } };
const notes = "const resolvers = { Query: { list: list } }";
function list() { return []; }
`,
    'api.py': `
@query.field("pythonUser")
def load_user():
    return None

@mutation.field("pythonCreate")
def create_user():
    return None

@strawberry.type
class Query:
    @strawberry.field
    def strawberry_user(self):
        return None

class Noise:
    @strawberry.field
    def list(self):
        return []
`,
    'resolver.go': `
package api
func (r *queryResolver) GoUser() string { return "" }
func (r *mutationResolver) GoCreate() string { return "" }
func (r *Helper) List() string { return "" }
`,
  }, async ({ graph, symbol, targets }) => {
    const field = (name: string) => targets('schema.graphql', name);
    expect(field('Query.getUser')).toEqual(['map.ts:getUser']);
    expect(field('Query.namedUser')).toEqual(['decorators.ts:UserResolver::fetch']);
    expect(field('Query.typedUser')).toEqual(['decorators.ts:UserResolver::typedUser']);
    expect(field('Query.pythonUser')).toEqual(['api.py:load_user']);
    expect(field('Query.strawberryUser')).toEqual(['api.py:Query::strawberry_user']);
    expect(field('Query.goUser')).toEqual(['resolver.go:queryResolver::GoUser']);
    expect(field('Mutation.createUser')).toEqual(['storage.ts:findUser']);
    expect(field('Mutation.pythonCreate')).toEqual(['api.py:create_user']);
    expect(field('Mutation.goCreate')).toEqual(['resolver.go:mutationResolver::GoCreate']);
    expect(field('Subscription.memberJoined')).toEqual(['names.js:onJoin']);
    expect(field('User.displayName')).toEqual(['decorators.ts:UserResolver::render']);
    expect(field('Query.list')).toEqual([]);
    expect(field('User.unrelated')).toEqual([]);
    const entry = symbol('schema.graphql', 'Query.getUser');
    const service = symbol('map.ts', 'databaseUser');
    expect(graph.getCallees(entry, 2).map(({ node }) => node.id)).toContain(service);
    expect(graph.getCallers(service, 2).map(({ node }) => node.id)).toContain(entry);
    expect(graph.getImpactRadius(service, 2).nodes.has(entry)).toBe(true);
  });
});

it('retracts an edited binding with stable endpoints and converges after SDL edits and deletion', async () => {
  const initial = 'type Query {\n first: String\n second: String\n}';
  const bindings = (name: string) => `function handle() { return 'x'; }\nconst resolvers = { Query: { ${name}: handle } };`;
  await schemaFixture({ 'schema.gql': initial, 'resolver.js': bindings('first') }, async ({ graph, write, remove, targets, symbol }) => {
    expect(targets('schema.gql', 'Query.first')).toEqual(['resolver.js:handle']);
    write('resolver.js', bindings('second'));
    await graph.sync({ paths: ['resolver.js'] });
    expect(targets('schema.gql', 'Query.first')).toEqual([]);
    expect(targets('schema.gql', 'Query.second')).toEqual(['resolver.js:handle']);
    remove('resolver.js');
    await graph.sync({ paths: ['resolver.js'] });
    expect(targets('schema.gql', 'Query.second')).toEqual([]);
    write('resolver.js', bindings('second'));
    await graph.sync();
    expect(targets('schema.gql', 'Query.second')).toEqual(['resolver.js:handle']);
    const obsolete = symbol('schema.gql', 'Query.second');
    write('schema.gql', 'type Query {\n renamed: String\n}');
    await graph.sync();
    expect(graph.getCallers(symbol('resolver.js', 'handle')).map(({ node }) => node.id)).not.toContain(obsolete);
    expect(targets('schema.gql', 'Query.renamed')).toEqual([]);
    remove('schema.gql');
    await graph.sync({ paths: ['schema.gql'] });
    expect(graph.getCallers(symbol('resolver.js', 'handle')).some(({ node }) => node.filePath.endsWith('.gql'))).toBe(false);
  });
});

it('fails closed on ambiguous schema keys and does not link without SDL', async () => {
  const resolver = 'function list() {}\nconst resolvers = { Query: { list } };';
  await schemaFixture({ 'resolver.js': resolver }, async ({ graph, symbol }) => {
    expect(graph.getCallers(symbol('resolver.js', 'list')).some(({ edge }) => edge.metadata?.synthesis === 'graphql-resolver')).toBe(false);
  });
  const declared = 'type Query {\n list: String\n}';
  await schemaFixture({ 'a.graphql': declared, 'b.graphql': declared, 'resolver.js': resolver }, async ({ targets }) => {
    expect(targets('a.graphql', 'Query.list')).toEqual([]);
    expect(targets('b.graphql', 'Query.list')).toEqual([]);
  });
});
