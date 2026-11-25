import { expect, it } from 'vitest';
import { schemaFixture } from './schema-dispatch-fixture';

const proto = (packageName: string, service: string, member = 'Create') => `
syntax = "proto3";
package ${packageName};
service ${service} {
  rpc ${member}(Request) returns (Response);
}
message Request {}
message Response {}
`;

it('links actual handlers by service across Go, TypeScript, JavaScript, Python and Java', async () => {
  await schemaFixture({
    'order.proto': proto('api', 'OrderService'),
    'payment.proto': proto('api', 'PaymentService'),
    'go/impl.go': `
package api
type Orders struct { pb.UnimplementedOrderServiceServer }
func (s *Orders) Create(ctx context.Context, req *pb.Request) {}
type Payments struct {}
func (s *Payments) Create(ctx context.Context, req *pb.Request) {}
type Helper struct {}
func (s *Helper) Create(ctx context.Context, req *pb.Request) {}
`,
    'go/register.go': `
package api
func setup(server *grpc.Server) {
  impl := &Payments{}
  pb.RegisterPaymentServiceServer(server, impl)
  config.missing = &Helper{}
  pb.RegisterPaymentServiceServer(server, missing)
}
`,
    'server.js': `
function save() { return 1; }
function createOrder() { return save(); }
function createUnrelated() { return 0; }
server.addService(pb.OrderServiceService, { create: createOrder });
const sample = "server.addService(pb.PaymentServiceService, { create: createUnrelated })";
// server.addService(pb.PaymentServiceService, { create: createUnrelated });
`,
    'service.ts': `
class PaymentHandler {
  @GrpcMethod('PaymentService', 'Create')
  pay() { return 1; }
}
server.addService(pb.PaymentServiceService, {
  create() { return 2; },
});
`,
    'server.py': `
class Orders(pb.OrderServiceServicer):
    def Create(self, request, context):
        return None

class Payments:
    def Create(self, request, context):
        return None

pb.add_PaymentServiceServicer_to_server(Payments(), server)
pb.add_OrderServiceServicer_to_server(Payments().alternate(), server)
`,
    'Server.java': `
class Orders extends OrderServiceGrpc.OrderServiceImplBase {
  @Override
  public void create(Request request, Observer observer) {}
}
class Noise {
  public void create(Request request, Observer observer) {}
}
`,
  }, async ({ graph, symbol, targets }) => {
    expect(targets('order.proto', 'api.OrderService.Create')).toEqual([
      'Server.java:Orders::create', 'go/impl.go:Orders::Create',
      'server.js:createOrder', 'server.py:Orders::Create',
    ]);
    expect(targets('payment.proto', 'api.PaymentService.Create')).toEqual([
      'go/impl.go:Payments::Create', 'server.py:Payments::Create',
      'service.ts:PaymentHandler::pay', 'service.ts:pb.PaymentServiceService@5:7::create',
    ]);
    const rpc = symbol('order.proto', 'api.OrderService.Create');
    const store = symbol('server.js', 'save');
    expect(graph.getCallees(rpc, 2).map(({ node }) => node.id)).toContain(store);
    expect(graph.getCallers(store, 2).map(({ node }) => node.id)).toContain(rpc);
    expect(graph.getImpactRadius(store, 2).nodes.has(rpc)).toBe(true);
  });
});

it('retracts registration-only changes and converges after RPC edits and deletion', async () => {
  await schemaFixture({
    'api.proto': proto('api', 'Orders'),
    'go/handler.go': 'package api\ntype Handler struct{}\nfunc (h *Handler) Create(ctx C, req R) {}',
    'go/register.go': 'package api\nfunc setup() { pb.RegisterOrdersServer(server, &Handler{}) }',
  }, async ({ graph, write, remove, symbol, targets }) => {
    expect(targets('api.proto', 'api.Orders.Create')).toEqual(['go/handler.go:Handler::Create']);
    write('go/register.go', 'package api\nfunc setup() {}');
    await graph.sync({ paths: ['go/register.go'] });
    expect(targets('api.proto', 'api.Orders.Create')).toEqual([]);
    write('go/register.go', 'package api\nfunc setup() { pb.RegisterOrdersServer(server, &Handler{}) }');
    await graph.sync();
    const old = symbol('api.proto', 'api.Orders.Create');
    expect(targets('api.proto', 'api.Orders.Create')).toEqual(['go/handler.go:Handler::Create']);
    write('api.proto', proto('api', 'Orders', 'Update'));
    await graph.sync({ paths: ['api.proto'] });
    expect(targets('api.proto', 'api.Orders.Update')).toEqual([]);
    expect(graph.getCallers(symbol('go/handler.go', 'Handler::Create')).map(({ node }) => node.id)).not.toContain(old);
    remove('api.proto');
    await graph.sync();
    expect(graph.getCallers(symbol('go/handler.go', 'Handler::Create'))).toEqual([]);
  });
});

it('refuses unqualified service bindings when the proto service name is ambiguous', async () => {
  await schemaFixture({
    'first.proto': proto('first', 'Orders'),
    'second.proto': proto('second', 'Orders'),
    'handler.js': 'function create() {}\nserver.addService(OrdersService, { create });',
  }, async ({ targets }) => {
    expect(targets('first.proto', 'first.Orders.Create')).toEqual([]);
    expect(targets('second.proto', 'second.Orders.Create')).toEqual([]);
  });
});
