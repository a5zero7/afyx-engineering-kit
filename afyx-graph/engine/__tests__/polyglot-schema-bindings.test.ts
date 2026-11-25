import { expect, it } from 'vitest';
import { schemaFixture } from './schema-dispatch-fixture';

it('links explicit Rust, C#, PHP and Ruby schema bindings and retracts changes', async () => {
  const schema = 'type Query {\n mappedRust: String\n mappedDotnet: String\n phpUser: String @field(resolver: "App\\\\Lighthouse@resolve")\n rubyUser: String\n unrelated: String\n}';
  const objectSchema = 'type Product {\n title: String\n}';
  const objectType = `namespace App;
class Product { public string GetTitle() { return ""; } }
class ProductType : HotChocolate.Types.ObjectType<App.Product> {
  protected override void Configure(HotChocolate.Types.IObjectTypeDescriptor<App.Product> descriptor) {
    descriptor.Name("Product");
    descriptor.Field(item => item.GetTitle()).Name("title");
  }
}
class Setup {
  public void Register() { services.AddGraphQLServer().AddType<App.ProductType>(); }
}`;
  const proto = (name: string) => 'syntax = "proto3";\npackage ' + name + ';\nservice Catalog {\n rpc GetUser (Request) returns (Reply);\n}';
  const rust = 'struct Query;\n#[async_graphql::Object]\nimpl Query { #[graphql(name = \"mappedRust\")] async fn rust_user(&self) {} }\nstruct Handler;\n#[tonic::async_trait]\nimpl crate::api::catalog_server::Catalog for Handler { async fn get_user(&self) {} }';
  await schemaFixture({
    'api.graphql': schema,
    'product.graphql': objectSchema,
    'Product.cs': objectType,
    'api.proto': proto('api'),
    'other.proto': proto('other'),
    'resolvers.rs': rust,
    'Dotnet.cs': 'namespace App;\n[HotChocolate.Types.QueryType]\npublic class Handler { [HotChocolate.GraphQLName(\"mappedDotnet\")] public string DotnetUser() { return ""; } }\nclass Server : api.Catalog.CatalogBase { public override string GetUser() { return ""; } }\nclass Other { public string Unrelated() { return ""; } }',
    'lighthouse.php': '<?php namespace App; class Lighthouse { public function resolve() {} }',
    'grpc.php': '<?php namespace App;\ninterface CatalogContract extends \\Spiral\\RoadRunner\\GRPC\\ServiceInterface {\n const NAME = "api.Catalog";\n public function GetUser($request);\n}\nclass CatalogHandler implements \\App\\CatalogContract {\n public function GetUser($request) {}\n}',
    'ruby.rb': 'class Query < GraphQL::Schema::Object\n field :ruby_user, resolver: LookupResolver\nend\nclass LookupResolver < GraphQL::Schema::Resolver\n def resolve\n end\nend',
    'ruby_grpc.rb': "module Api\n module Catalog\n  class Service\n   include GRPC::GenericService\n   self.service_name = 'api.Catalog'\n   rpc :GetUser, Request, Reply\n  end\n end\nend\nclass RubyHandler < Api::Catalog::Service\n def get_user\n end\nend",
  }, async ({ graph, targets, write }) => {
    expect(targets('product.graphql', 'Product.title')).toEqual(['Product.cs:App::Product::GetTitle']);
    write('Product.cs', objectType.replace('AddGraphQLServer()', 'OtherBuilder()'));
    await graph.sync({ paths: ['Product.cs'] });
    expect(targets('product.graphql', 'Product.title')).toEqual([]);
    expect(targets('api.graphql', 'Query.mappedRust')).toEqual(['resolvers.rs:Query::rust_user']);
    expect(targets('api.graphql', 'Query.mappedDotnet')).toEqual(['Dotnet.cs:App::Handler::DotnetUser']);
    expect(targets('api.graphql', 'Query.phpUser')).toEqual(['lighthouse.php:App::Lighthouse::resolve']);
    expect(targets('api.graphql', 'Query.rubyUser')).toEqual(['ruby.rb:LookupResolver::resolve']);
    expect(targets('api.graphql', 'Query.unrelated')).toEqual([]);
    expect(targets('api.proto', 'api.Catalog.GetUser')).toEqual([
      'Dotnet.cs:App::Server::GetUser', 'grpc.php:App::CatalogHandler::GetUser',
      'resolvers.rs:Handler::get_user', 'ruby_grpc.rb:RubyHandler::get_user',
    ]);
    expect(targets('other.proto', 'other.Catalog.GetUser')).toEqual([]);
    write('resolvers.rs', rust.replace('#[async_graphql::Object]', '').replace('crate::api::', 'crate::other::'));
    await graph.sync({ paths: ['resolvers.rs'] });
    expect(targets('api.graphql', 'Query.mappedRust')).toEqual([]);
    expect(targets('other.proto', 'other.Catalog.GetUser')).toEqual(['resolvers.rs:Handler::get_user']);
    const rebuilt = { 'api.graphql': schema, 'api.proto': proto('api'), 'other.proto': proto('other'),
      'resolvers.rs': rust.replace('#[async_graphql::Object]', '').replace('crate::api::', 'crate::other::') };
    await schemaFixture(rebuilt, async fresh => {
      expect(targets('other.proto', 'other.Catalog.GetUser')).toEqual(fresh.targets('other.proto', 'other.Catalog.GetUser'));
      expect(targets('api.graphql', 'Query.mappedRust')).toEqual(fresh.targets('api.graphql', 'Query.mappedRust'));
    });
    await graph.sync();
    expect(targets('other.proto', 'other.Catalog.GetUser')).toHaveLength(1);
  });
});
