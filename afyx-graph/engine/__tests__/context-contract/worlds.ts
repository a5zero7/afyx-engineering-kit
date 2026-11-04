/**
 * Synthetic projects for the context contract. Everything is generated from fixed
 * lists: no randomness, stable ids, stable file contents.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Node, Edge, EdgeKind, NodeKind, Language } from '../../src/types';
import { unit, type FakeWorld } from './fake-graph';

const LANGUAGE_BY_EXT: Record<string, Language> = { ts: 'typescript', tsx: 'tsx', js: 'javascript', py: 'python', go: 'go', java: 'java', rb: 'ruby', yaml: 'yaml', dart: 'dart' };

class Builder {
  readonly nodes: Node[] = [];
  readonly edges: Edge[] = [];
  private readonly files = new Map<string, Node>();

  file(filePath: string): Node {
    let node = this.files.get(filePath);
    if (!node) {
      node = this.raw('file', path.posix.basename(filePath), filePath, 1, 120);
      this.files.set(filePath, node);
    }
    return node;
  }

  private raw(kind: NodeKind, name: string, filePath: string, startLine: number, endLine: number, extra: Partial<Node> = {}): Node {
    const ext = filePath.split('.').pop() ?? 'ts';
    const node: Node = {
      id: `${kind}:${Math.floor(unit(`${filePath}::${name}::${startLine}::${kind}`) * 0xffffffff).toString(16).padStart(8, '0')}`,
      kind, name,
      qualifiedName: `${filePath}::${name}`,
      filePath,
      language: LANGUAGE_BY_EXT[ext] ?? 'typescript',
      startLine, endLine, startColumn: 0, endColumn: 1,
      ...extra,
    };
    this.nodes.push(node);
    return node;
  }

  /** A symbol contained in its file; returns the node. */
  symbol(kind: NodeKind, name: string, filePath: string, startLine: number, endLine: number, extra: Partial<Node> = {}): Node {
    const node = this.raw(kind, name, filePath, startLine, endLine, { signature: kind === 'function' || kind === 'method' ? `${name}(input: unknown): void` : undefined, ...extra });
    this.link(this.file(filePath), node, 'contains');
    return node;
  }

  /** A member contained in its owner (a class), as well as living in the owner's file. */
  member(owner: Node, kind: NodeKind, name: string, startLine: number, endLine: number, extra: Partial<Node> = {}): Node {
    const node = this.raw(kind, name, owner.filePath, startLine, endLine, { signature: `${name}(input: unknown): void`, ...extra });
    this.link(owner, node, 'contains');
    return node;
  }

  link(source: Node, target: Node, kind: EdgeKind, extra: Partial<Edge> = {}): void {
    this.edges.push({ source: source.id, target: target.id, kind, line: source.startLine + 1, ...extra });
  }

  world(extra: Partial<FakeWorld> = {}): FakeWorld {
    return { nodes: this.nodes, edges: this.edges, ...extra };
  }
}

function commerce(): FakeWorld {
  const b = new Builder();
  const orderService = b.symbol('class', 'OrderService', 'src/orders/OrderService.ts', 5, 90, { isExported: true });
  const createOrder = b.member(orderService, 'method', 'createOrder', 10, 30);
  const validateOrder = b.member(orderService, 'method', 'validateOrder', 32, 44);
  const cancelOrder = b.member(orderService, 'method', 'cancelOrder', 46, 60);
  const orderRepo = b.symbol('class', 'OrderRepository', 'src/orders/OrderRepository.ts', 3, 70);
  const saveOrder = b.member(orderRepo, 'method', 'save', 8, 20);
  const findOrder = b.member(orderRepo, 'method', 'find', 22, 34);
  const iRepo = b.symbol('interface', 'IOrderRepository', 'src/orders/OrderRepository.ts', 72, 80);
  const stateMachine = b.symbol('class', 'OrderStateMachine', 'src/orders/OrderStateMachine.ts', 4, 100);
  const transition = b.member(stateMachine, 'method', 'transition', 10, 40);
  const canTransition = b.member(stateMachine, 'method', 'canTransition', 42, 55);
  const orderStatus = b.symbol('enum', 'OrderStatus', 'src/orders/OrderStatus.ts', 1, 12);
  const orderDto = b.symbol('type_alias', 'OrderDto', 'src/orders/OrderDto.ts', 1, 9);

  const paymentService = b.symbol('class', 'PaymentService', 'src/payments/PaymentService.ts', 5, 80);
  const charge = b.member(paymentService, 'method', 'charge', 10, 30);
  const refund = b.member(paymentService, 'method', 'refund', 32, 50);
  const gateway = b.symbol('interface', 'PaymentGateway', 'src/payments/PaymentGateway.ts', 1, 15);
  const baseGateway = b.symbol('class', 'BaseGateway', 'src/payments/BaseGateway.ts', 1, 40);
  const stripe = b.symbol('class', 'StripeGateway', 'src/payments/StripeGateway.ts', 1, 60);
  const paypal = b.symbol('class', 'PaypalGateway', 'src/payments/PaypalGateway.ts', 1, 60);
  const stripeCharge = b.member(stripe, 'method', 'charge', 12, 30);
  const paypalCharge = b.member(paypal, 'method', 'charge', 12, 30);

  const http = b.symbol('class', 'HttpClient', 'src/shared/http/HttpClient.ts', 3, 110);
  const httpGet = b.member(http, 'method', 'get', 10, 20);
  const httpPost = b.member(http, 'method', 'post', 22, 32);
  const request = b.member(http, 'method', 'request', 34, 90);
  const retry = b.symbol('function', 'retryWithBackoff', 'src/shared/http/retry.ts', 2, 40);
  const withTimeout = b.symbol('function', 'withTimeout', 'src/shared/http/retry.ts', 42, 60);

  const cacheBuilder = b.symbol('class', 'CacheBuilder', 'src/cache/CacheBuilder.ts', 2, 90);
  const cbBuild = b.member(cacheBuilder, 'method', 'build', 8, 20);
  const cbEvict = b.member(cacheBuilder, 'method', 'evict', 22, 40);
  const lru = b.symbol('class', 'LruCache', 'src/cache/LruCache.ts', 2, 70);
  const cacheManager = b.symbol('class', 'CacheManager', 'src/cache/CacheManager.ts', 2, 50);
  const cacheKey = b.symbol('function', 'cacheKey', 'src/cache/keys.ts', 1, 12);
  const evictEntries = b.symbol('function', 'evictEntries', 'src/cache/eviction.ts', 1, 30);

  const searchController = b.symbol('class', 'SearchController', 'src/search/SearchController.ts', 2, 60);
  const searchAction = b.symbol('class', 'TransportSearchAction', 'src/search/TransportSearchAction.ts', 2, 60);
  const shardRequest = b.symbol('class', 'ShardSearchRequest', 'src/search/ShardSearchRequest.ts', 2, 40);
  const searchShards = b.symbol('class', 'SearchShardsRequest', 'src/search/SearchShardsRequest.ts', 2, 40);
  const searchRun = b.symbol('function', 'run', 'src/search/runner.ts', 1, 20);
  const execUtils = b.symbol('class', 'ExecutionUtils', 'src/exec/ExecutionUtils.ts', 1, 30);

  const helpers = ['get', 'set', 'run', 'handle', 'check', 'update', 'data', 'flow'].map((name, index) => b.symbol('function', name, 'src/utils/helpers.ts', 1 + index * 6, 5 + index * 6));
  const maxRetries = b.symbol('constant', 'MAX_RETRIES', 'src/utils/constants.ts', 1, 1);
  const defaultTimeout = b.symbol('constant', 'DEFAULT_TIMEOUT', 'src/utils/constants.ts', 2, 2);
  const flat = b.symbol('constant', 'FLAT', 'src/utils/constants.ts', 3, 3);
  const pinFeed = b.symbol('function', 'pinFeedIfNearBottom', 'src/ui/feed.ts', 2, 20);
  const feedAtBottom = b.symbol('function', 'feedAtBottom', 'src/ui/feed.ts', 22, 30);
  const handleFeedScroll = b.symbol('function', 'handleFeedScroll', 'src/ui/feed.ts', 32, 50);
  const profileInfo = b.symbol('variable', 'profileInfo', 'src/user/profile.ts', 1, 1);
  const getProfileInfoV2 = b.symbol('function', 'getProfileInfoV2', 'src/user/profile.ts', 3, 20);
  const extensionHost = b.symbol('class', 'ExtensionHostProcess', 'src/host/ExtensionHostProcess.ts', 1, 40);
  const extensionService = b.symbol('class', 'ExtensionService', 'src/host/ExtensionService.ts', 1, 40);
  const rpcProtocol = b.symbol('class', 'RPCProtocol', 'src/ipc/RPCProtocol.ts', 1, 40);
  const ipcChannel = b.symbol('class', 'IpcChannel', 'src/ipc/IpcChannel.ts', 1, 40);
  const routeCreate = b.symbol('route', 'POST /orders', 'src/api/routes.ts', 5, 9);
  const orderList = b.symbol('component', 'OrderList', 'src/ui/OrderList.tsx', 3, 40);
  const orderForm = b.symbol('component', 'OrderForm', 'src/ui/OrderForm.tsx', 3, 40);
  const nsUtil = b.symbol('namespace', 'Util', 'src/utils/util.ts', 1, 20);
  const moduleNode = b.symbol('module', 'orders', 'src/orders/index.ts', 1, 3);
  const importOrder = b.symbol('import', 'OrderService', 'src/api/routes.ts', 1, 1);
  const importGhost = b.symbol('import', 'GhostService', 'src/api/routes.ts', 2, 2);
  const exportOrder = b.symbol('export', 'OrderRepository', 'src/orders/index.ts', 2, 2);
  const importPay = b.symbol('import', 'PaymentService', 'src/api/routes.ts', 3, 3);

  const testOrder = b.symbol('function', 'testCreateOrder', 'tests/orders/OrderService.test.ts', 3, 20);
  const testOrderSuite = b.symbol('class', 'OrderServiceTest', 'tests/orders/OrderServiceTest.java', 3, 60);
  const testHelpers = ['assertOrder', 'buildOrder', 'orderFixture', 'mockOrders', 'stubGateway', 'fakeClock'].map((name, index) => b.symbol('function', name, `src/orders/__tests__/helpers${index}.ts`, 1, 12));
  const sample = b.symbol('function', 'createOrderSample', 'examples/demo/sample.ts', 1, 14);
  const fixture = b.symbol('constant', 'orderFixtureData', 'fixtures/orders/data.ts', 1, 3);

  const pbGetOrder = b.symbol('function', 'GetOrder', 'api/gen/orders.pb.go', 10, 30, { language: 'go' });
  const pbCreateOrder = b.symbol('function', 'CreateOrder', 'api/gen/orders.pb.go', 32, 50, { language: 'go' });
  const genSchema = b.symbol('class', 'OrderSchema', 'src/generated/schema.ts', 1, 30);
  const headerGen = b.symbol('class', 'OrderProjection', 'src/projections/OrderProjection.ts', 1, 30);

  const vanished = b.symbol('function', 'vanishedFn', 'missing/gone.ts', 1, 5);
  const escaping = b.symbol('function', 'escapingFn', '../outside/escape.ts', 1, 5);
  b.link(createOrder, vanished, 'calls'); b.link(vanished, escaping, 'calls');

  const dbPassword = b.symbol('constant', 'database.password', 'config/app.yaml', 3, 3, { language: 'yaml', signature: 'password' });
  const apiKey = b.symbol('constant', 'api.key', 'config/app.yaml', 4, 4, { language: 'yaml' });

  const hub = b.symbol('function', 'dispatchEvent', 'src/events/dispatcher.ts', 1, 90);
  const handlers = Array.from({ length: 40 }, (_, index) => b.symbol('function', `onEvent${index}`, `src/events/handlers/handler${index % 8}.ts`, 1 + (index % 5) * 8, 7 + (index % 5) * 8));
  for (const handler of handlers) b.link(hub, handler, 'calls');
  b.link(handlers[3]!, hub, 'calls');

  // structure and relationships
  b.link(stripe, baseGateway, 'extends'); b.link(paypal, baseGateway, 'extends');
  b.link(stripe, gateway, 'implements'); b.link(paypal, gateway, 'implements'); b.link(baseGateway, gateway, 'implements');
  b.link(orderRepo, iRepo, 'implements');
  b.link(stripeCharge, charge, 'overrides'); b.link(paypalCharge, charge, 'overrides');
  b.link(createOrder, validateOrder, 'calls'); b.link(validateOrder, createOrder, 'calls'); b.link(createOrder, saveOrder, 'calls');
  b.link(createOrder, charge, 'calls'); b.link(cancelOrder, refund, 'calls'); b.link(cancelOrder, findOrder, 'calls'); b.link(cancelOrder, transition, 'calls');
  b.link(transition, canTransition, 'calls'); b.link(charge, request, 'calls'); b.link(refund, request, 'calls'); b.link(request, retry, 'calls'); b.link(retry, withTimeout, 'calls');
  b.link(httpGet, request, 'calls'); b.link(httpPost, request, 'calls'); b.link(cbBuild, cacheKey, 'calls'); b.link(cbEvict, evictEntries, 'calls'); b.link(cacheManager, cacheBuilder, 'references');
  b.link(lru, cacheBuilder, 'references'); b.link(cbBuild, lru, 'calls');
  b.link(searchController, searchAction, 'references'); b.link(searchAction, shardRequest, 'references'); b.link(searchAction, searchShards, 'references'); b.link(searchRun, execUtils, 'calls');
  b.link(orderList, orderForm, 'references'); b.link(routeCreate, createOrder, 'navigates'); b.link(importOrder, orderService, 'imports'); b.link(importPay, paymentService, 'imports');
  b.link(exportOrder, orderRepo, 'exports'); b.link(orderService, orderRepo, 'references'); b.link(orderService, stateMachine, 'references'); b.link(orderService, orderStatus, 'references'); b.link(orderService, orderDto, 'references');
  b.link(testOrder, createOrder, 'calls'); b.link(testOrderSuite, orderService, 'references'); for (const helper of testHelpers) b.link(helper, createOrder, 'calls'); b.link(sample, createOrder, 'calls');
  b.link(pbGetOrder, pbCreateOrder, 'calls'); b.link(createOrder, pbGetOrder, 'calls'); b.link(pinFeed, feedAtBottom, 'calls'); b.link(pinFeed, handleFeedScroll, 'calls'); b.link(handleFeedScroll, feedAtBottom, 'calls');
  b.link(getProfileInfoV2, profileInfo, 'references'); b.link(extensionHost, extensionService, 'references'); b.link(rpcProtocol, ipcChannel, 'references'); b.link(helpers[2]!, helpers[3]!, 'calls');
  b.link(maxRetries, defaultTimeout, 'references'); b.link(flat, maxRetries, 'references'); b.link(genSchema, headerGen, 'references'); b.link(moduleNode, nsUtil, 'references'); b.link(dbPassword, apiKey, 'references');
  b.link(fixture, sample, 'references'); b.link(execUtils, searchRun, 'calls');

  // synthesized (dynamic-dispatch) hops, one per label the call-path section knows
  const synth: Array<[Node, Node, Record<string, unknown>]> = [
    [createOrder, validateOrder, { synthesizedBy: 'callback', via: 'onOrder', registeredAt: 'src/orders/OrderService.ts:12' }],
    [charge, request, { synthesizedBy: 'callback' }],
    [orderList, orderForm, { synthesizedBy: 'react-render', registeredAt: 'src/ui/OrderList.tsx:9' }],
    [orderForm, orderList, { synthesizedBy: 'jsx-render', via: 'OrderList' }],
    [cbBuild, cbEvict, { synthesizedBy: 'vue-handler', event: 'click' }],
    [httpGet, httpPost, { synthesizedBy: 'http-client', method: 'POST', href: '/orders', registeredAt: 'src/shared/http/HttpClient.ts:20' }],
    [saveOrder, findOrder, { synthesizedBy: 'queue-job', event: 'order.saved', queue: 'orders' }],
    [pinFeed, feedAtBottom, { synthesizedBy: 'event-bus', channel: 'socket', event: 'feed', tier: 'client→server' }],
    [handleFeedScroll, pinFeed, { synthesizedBy: 'event-bus', channel: 'socket', event: 'scroll', tier: 'server→client' }],
    [canTransition, transition, { synthesizedBy: 'event-bus', event: 'state' }],
  ];
  for (const [from, to, metadata] of synth) b.link(from, to, 'calls', { provenance: 'heuristic', metadata });
  void importGhost; void exportOrder; void dbPassword;

  return b.world({
    deprioritized: (filePath) => filePath.startsWith('src/exec/') || filePath.includes('/legacy/'),
    headerGenerated: new Set(['src/projections/OrderProjection.ts']),
  });
}

/** A framework-style project where one core file holds most of the in-file edges. */
function coreDominant(): FakeWorld {
  const b = new Builder();
  const base = b.symbol('class', 'Base', 'lib/core/base.rb', 1, 400, { language: 'ruby' });
  const routeBang = b.member(base, 'method', 'route!', 10, 30, { language: 'ruby' });
  const dispatch = b.member(base, 'method', 'dispatch!', 32, 60, { language: 'ruby' });
  const filterRun = b.member(base, 'method', 'filter!', 62, 90, { language: 'ruby' });
  b.link(routeBang, dispatch, 'calls'); b.link(dispatch, filterRun, 'calls'); b.link(filterRun, routeBang, 'calls');
  const helpers = Array.from({ length: 24 }, (_, index) => b.member(base, 'method', `helper${index}`, 100 + index * 5, 103 + index * 5, { language: 'ruby' }));
  helpers.forEach((helper, index) => b.link(helper, index === 0 ? routeBang : helpers[index - 1]!, 'calls'));
  const ext = b.symbol('class', 'MultiRoute', 'contrib/lib/multi_route.rb', 1, 40, { language: 'ruby' });
  const extRoute = b.member(ext, 'method', 'route', 5, 9, { language: 'ruby' });
  const coreRoute = b.symbol('function', 'route', 'lib/core/router.rb', 1, 12, { language: 'ruby' });
  b.link(extRoute, routeBang, 'calls'); b.link(coreRoute, routeBang, 'calls');
  return b.world({ dominantFile: { filePath: 'lib/core/base.rb', edgeCount: 90, nextEdgeCount: 12 } });
}

/** One huge class plus a flood of test nodes: exercises the per-file and non-production caps. */
function crowded(): FakeWorld {
  const b = new Builder();
  const big = b.symbol('class', 'AllocationService', 'src/alloc/AllocationService.ts', 1, 500);
  const methods = Array.from({ length: 70 }, (_, index) => b.member(big, 'method', `allocate${index}`, 10 + index * 6, 14 + index * 6));
  methods.forEach((method, index) => { if (index > 0) b.link(methods[index - 1]!, method, 'calls'); });
  const metrics = b.symbol('class', 'AllocationBalancingRoundMetrics', 'src/alloc/Metrics.ts', 1, 30);
  const helper = b.symbol('class', 'AllocationHelper', 'src/alloc/AllocationHelper.ts', 1, 30);
  b.link(big, metrics, 'references'); b.link(big, helper, 'references');
  for (let index = 0; index < 30; index++) {
    const guard = b.symbol('class', `GuardImpl${index}`, `integration/guards/Guard${index}.ts`, 1, 20);
    b.link(guard, big, 'references');
    const spec = b.symbol('function', `allocateSpec${index}`, `tests/alloc/spec${index}.test.ts`, 1, 12);
    b.link(spec, methods[index]!, 'calls');
  }
  return b.world({});
}

/** Ratio exactly at the dominance threshold (3x). */
function coreBoundary(): FakeWorld {
  const world = coreDominant();
  return { ...world, dominantFile: { filePath: 'lib/core/base.rb', edgeCount: 36, nextEdgeCount: 12 } };
}

/** A six-node call chain whose two ends are both named by a query: exactly the call-path hop limit. */
function chain(): FakeWorld {
  const b = new Builder();
  const names = ['walkStart', 'walkB', 'walkC', 'walkD', 'walkE', 'walkEnd'];
  const nodes = names.map((name, index) => b.symbol('function', name, `src/chain/step${index}.ts`, 1, 12));
  nodes.forEach((node, index) => { if (index > 0) b.link(nodes[index - 1]!, node, 'calls'); });
  const longer = names.map((name, index) => b.symbol('function', `${name}Long`, `src/chain/long${index}.ts`, 1, 12));
  longer.forEach((node, index) => { if (index > 0) b.link(longer[index - 1]!, node, 'calls'); });
  const spur = b.symbol('function', 'walkSpur', 'src/chain/spur.ts', 1, 9);
  b.link(nodes[2]!, spur, 'calls'); b.link(spur, nodes[2]!, 'calls');
  return b.world({});
}

/** A type hierarchy larger than the hierarchy budget, with parents, siblings and an interface. */
function hierarchy(): FakeWorld {
  const b = new Builder();
  const abstractEngine = b.symbol('class', 'AbstractEngine', 'engine/AbstractEngine.ts', 1, 30);
  const engine = b.symbol('class', 'Engine', 'engine/Engine.ts', 1, 60);
  const runnable = b.symbol('interface', 'Runnable', 'engine/Runnable.ts', 1, 9);
  b.link(engine, abstractEngine, 'extends'); b.link(engine, runnable, 'implements');
  for (const name of ['InternalEngine', 'ReadOnlyEngine', 'FrozenEngine', 'ShadowEngine', 'NoOpEngine', 'ReplicaEngine', 'PrimaryEngine', 'MirrorEngine', 'ColdEngine', 'HotEngine', 'WarmEngine', 'ArchiveEngine']) {
    const sub = b.symbol('class', name, `engine/impl/${name}.ts`, 1, 40);
    b.link(sub, engine, 'extends');
  }
  for (let index = 0; index < 5; index++) {
    const sibling = b.symbol('class', `AbstractSibling${index}`, `engine/sib/AbstractSibling${index}.ts`, 1, 20);
    b.link(sibling, abstractEngine, 'extends');
  }
  for (const family of ['FamAlpha', 'FamBeta', 'FamGamma', 'FamDelta']) {
    const parent = b.symbol('class', family, `fam/${family}.ts`, 1, 20);
    for (const child of ['One', 'Two', 'Three']) {
      const sub = b.symbol('class', `${family}${child}`, `fam/${family}${child}.ts`, 1, 12);
      b.link(sub, parent, 'extends');
    }
  }
  return b.world({});
}

/** Many classes whose names contain the same interior words: camel-infix and compound matching at scale. */
function elastic(): FakeWorld {
  const b = new Builder();
  const prefixes = ['Search', 'Shard', 'Transport', 'Node', 'Cluster', 'Rest', 'Bulk', 'Abstract', 'Dfs', 'Query', 'Fetch', 'Expand'];
  const middles = ['Shard', 'Search', 'Request', 'Index', 'Node', 'Shards'];
  const suffixes = ['Action', 'Request', 'Phase', 'Context', 'Listener', 'Service', 'Builder'];
  let counter = 0;
  for (const prefix of prefixes) {
    for (const middle of middles) {
      for (const suffix of suffixes) {
        if (counter++ % 3 !== 0) continue;
        const name = `${prefix}${middle}${suffix}`;
        b.symbol('class', name, `server/${['action', 'search', 'shard', 'transport'][counter % 4]}/${name}.java`, 1, 30, { language: 'java' });
      }
    }
  }
  const fns = ['getSearchShardsV2', 'buildSearchRequest', 'shardSearchTimeout'].map((name, index) => b.symbol('method', name, `server/util/fn${index}.java`, 1, 8, { language: 'java' }));
  fns.forEach((node, index) => { if (index) b.link(fns[index - 1]!, node, 'calls'); });
  return b.world({});
}

/**
 * Infix-channel targets. Family A: a two-word class that ranks 7th among "Alpha" humps, exactly at the
 * edge of the accumulation pool. Family B: snake_case functions containing two query words, which are
 * not hump-eligible and are reachable only through compound matching.
 */
function infix(): FakeWorld {
  const b = new Builder();
  ['FooAlpha', 'BarAlpha', 'BazAlpha', 'QuxAlpha', 'ZipAlpha', 'ZapAlpha'].forEach((name, index) => b.symbol('class', name, `lib/a/m${index}.ts`, 1, 20));
  b.symbol('class', 'FooAlphaBetaHandler', 'lib/a/m9.ts', 1, 20);
  b.symbol('class', 'NetBetaHelper', 'lib/b/m10.ts', 1, 20);
  for (const name of ['open_gateway_session', 'close_gateway_session', 'init_gateway_session', 'reset_session_gateway', 'drop_gateway_session_now']) {
    b.symbol('function', name, `py/net/${name.length}.py`, 1, 9, { language: 'python' });
  }
  b.symbol('function', 'open_gateway_only', 'py/net/only.py', 1, 9, { language: 'python' });
  return b.world({});
}

function tiny(): FakeWorld {
  const b = new Builder();
  const a = b.symbol('function', 'parseToken', 'src/parser.ts', 1, 3);
  const c = b.symbol('class', 'ApiService', 'src/service.ts', 1, 9);
  const d = b.symbol('method', 'authenticate', 'src/service.ts', 3, 6);
  b.link(d, a, 'calls'); b.link(c, d, 'contains');
  return b.world({});
}

export const WORLDS: Record<string, () => FakeWorld> = {
  commerce,
  coreDominant,
  crowded,
  tiny,
  coreBoundary,
  chain,
  hierarchy,
  elastic,
  infix,
  empty: () => ({ nodes: [], edges: [] }),
};

/** Writes deterministic file contents for every file node; long lines make some bodies exceed block limits. */
export function writeProject(world: FakeWorld, root: string): void {
  const files = new Set(world.nodes.map((node) => node.filePath));
  for (const filePath of files) {
    const target = path.join(root, ...filePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const lines = Array.from({ length: 130 }, (_, index) => `L${index + 1} ${filePath} ${'x'.repeat((index % 9) * 24)}`);
    if (filePath === 'config/app.yaml') lines[2] = 'password: hunter2-secret';
    fs.writeFileSync(target, lines.join('\n'));
  }
}

const COMMERCE_QUERIES = [
  'OrderService', 'createOrder', 'how does order creation work', 'OrderStateMachine transition', 'payment gateway charge', 'PaymentService refund', 'StripeGateway',
  'retryWithBackoff HttpClient', 'how is caching implemented', 'CacheBuilder evict', 'eviction management', 'caching', 'scrape loop', 'search execution from request to shard',
  'ShardSearchRequest', 'TransportSearchAction', 'flat object', 'FLAT', 'MAX_RETRIES DEFAULT_TIMEOUT', 'get set run handle', 'handle', 'run', 'update check data flow',
  'pinFeedIfNearBottom feedAtBottom handleFeedScroll', 'auto-scroll to bottom feed', 'profileInfo', 'getProfileInfoV2', 'ExtensionHostProcess', 'RPCProtocol IpcChannel', 'REST', 'bulk',
  'test createOrder', 'spec for order service', 'OrderServiceTest', 'examples demo', 'GetOrder CreateOrder', 'OrderSchema', 'OrderProjection', 'database.password', 'api.key',
  'dispatchEvent onEvent3', 'dispatch event handlers', 'POST /orders route', 'OrderList OrderForm', 'Util namespace', 'orders module', 'GhostService', 'import PaymentService',
  'src/orders/OrderService.ts', 'src/payments', 'what breaks if I change createOrder', 'callers of charge', 'who calls request', 'dependencies of OrderRepository', 'IOrderRepository',
  'BaseGateway PaypalGateway', 'OrderStatus enum', 'OrderDto', 'cancelOrder refund flow', 'validateOrder createOrder cycle', 'x', 'ab', 'the', '', '   ', 'zzzz nothing matches this at all',
  'How does the payment flow reach the http client retry logic', 'ExecutionUtils', 'legacy exec', 'helper functions', 'Service', 'Gateway', 'Cache', 'Order Payment Cache', 'orderService.createOrder',
  'app.isPackaged', 'snake_case_name', 'CONSTANT_NAME', 'HTTPServer', 'a b c d e f', 'unicode Ünïcödé query', 'cache-builder', 'order_state_machine', 'OrderState', 'Stripe', 'Paypal',
  'where is retry handled and how are timeouts applied', 'create order and charge payment', 'refund', 'transition canTransition', 'onEvent39', 'hub dispatch fan out', 'sample demo fixture',
];

const OTHER_QUERIES: Record<string, string[]> = {
  coreDominant: ['route', 'route!', 'dispatch filter', 'Base', 'MultiRoute', 'helper5', 'how does routing work', 'helper23 route!'],
  crowded: ['AllocationService', 'allocate5', 'Allocation', 'AllocationBalancingRoundMetrics', 'GuardImpl3', 'allocateSpec2', 'test allocate', 'allocation balancing', 'how does allocation work'],
  coreBoundary: ['route', 'route!', 'dispatch filter', 'how does routing work'],
  chain: ['walkStart walkEnd', 'walkStart walkB walkC walkD walkE walkEnd', 'walkStart', 'walkEndLong walkStartLong', 'walkSpur walkC'],
  hierarchy: ['FamAlpha FamBeta FamGamma FamDelta', 'FamAlpha FamBeta FamGamma', 'FamAlphaOne FamBetaTwo', 'Engine', 'InternalEngine', 'ReadOnlyEngine', 'AbstractEngine', 'Runnable', 'engine hierarchy subclasses', 'FrozenEngine ShadowEngine'],
  elastic: ['search', 'shard', 'request', 'action', 'phase', 'context', 'listener', 'service', 'search shard', 'shard request', 'search request action', 'transport search action', 'node shard context', 'cluster search shards request', 'bulk request listener', 'abstract search phase', 'search shard request', 'shard search request transport', 'Search Shard', 'TransportSearchAction', 'bulk shard action', 'getSearchShardsV2', 'search request timeout', 'transport search', 'fetch search phase context', 'dfs query search shards', 'rest search action service', 'expand search request listener', 'node cluster shard'],
  infix: ['alpha beta', 'Alpha Beta', 'gateway session', 'gateway session alpha', 'session gateway', 'alpha', 'beta', 'open gateway', 'alpha beta gateway session', 'FooAlphaBetaHandler', 'gateway'],
  tiny: ['parseToken', 'ApiService authenticate', 'authenticate a token with parseToken', 'nothing'],
  empty: ['anything', 'OrderService', ''],
};

export function queriesFor(world: string): string[] {
  return world === 'commerce' ? COMMERCE_QUERIES : OTHER_QUERIES[world] ?? [];
}

/** Option variants applied to every query (besides defaults). */
export const OPTION_VARIANTS: Array<{ name: string; options: Record<string, unknown> }> = [
  { name: 'wide', options: { searchLimit: 8, traversalDepth: 2, maxNodes: 40 } },
  { name: 'narrow', options: { searchLimit: 1, traversalDepth: 0, maxNodes: 6 } },
  { name: 'deep', options: { searchLimit: 3, traversalDepth: 3, maxNodes: 12 } },
  { name: 'kinds', options: { nodeKinds: ['class', 'method'], edgeKinds: ['calls', 'extends'] } },
  { name: 'minScore', options: { minScore: 40 } },
  { name: 'exports', options: { nodeKinds: ['export', 'import', 'class'], searchLimit: 5 } },
  { name: 'deepChain', options: { traversalDepth: 8, maxNodes: 50, searchLimit: 3 } },
  { name: 'seeded', options: { seedNames: ['createOrder', 'ExtensionService', 'nonexistentSeed', 'OrderRepository'] } },
];
