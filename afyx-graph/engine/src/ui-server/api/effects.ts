/**
 * AFYX Graph Native External-Effect Classifier.
 *
 * Source-grounded semantic classification of external effects (network, database,
 * response, queue, storage, auth, cache, email, process, device, telemetry, payments)
 * across polyglot languages and web/app/api runtimes.
 *
 * Architecture: Declarative token boundaries, explicit receiver and operation
 * vocabulary sets, bounded memory scanning, and deterministic access resolution.
 */

import type { Language } from '../../types';

export type EffectCategory =
  | 'network'
  | 'storage'
  | 'device'
  | 'telemetry'
  | 'database'
  | 'response'
  | 'queue'
  | 'email'
  | 'payments'
  | 'cache'
  | 'auth'
  | 'process';

export type ProjectKind = 'app' | 'api' | 'web';

export type Family = 'js' | 'py' | 'jvm' | 'cs' | 'go' | 'c' | 'rb' | 'php' | 'swift' | 'rs';

export const LANGUAGE_FAMILIES: Readonly<Record<Family, ReadonlySet<Language>>> = Object.freeze({
  js: new Set<Language>(['javascript', 'typescript', 'tsx', 'jsx']),
  py: new Set<Language>(['python']),
  jvm: new Set<Language>(['java', 'kotlin', 'scala']),
  cs: new Set<Language>(['csharp']),
  go: new Set<Language>(['go']),
  c: new Set<Language>(['c', 'cpp', 'objc']),
  rb: new Set<Language>(['ruby']),
  php: new Set<Language>(['php']),
  swift: new Set<Language>(['swift']),
  rs: new Set<Language>(['rust']),
});

export interface EffectInput {
  text: string;
  kind: 'calls' | 'instantiates';
  language?: Language | null;
  project?: ProjectKind;
  receiverType?: string | null;
  args?: string | null;
}

export interface Effect {
  category: EffectCategory;
  model?: string;
  access?: 'read' | 'write';
}

interface CallShape {
  normalized: string;
  segments: string[];
  lower: string[];
  first: string;
  last: string;
  family: Family | null;
}

const words = (...items: string[]): ReadonlySet<string> =>
  new Set(items.map((item) => item.toLowerCase()));

// System runtime boundaries and exceptions (never external effects)
const RUNTIME_ROOTS = words(
  'Object', 'Array', 'Promise', 'Date', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Reflect', 'Buffer', 'JSON', 'Math', 'Number', 'String', 'Symbol', 'Error',
  'BigInt', 'Intl', 'Atomics', 'Proxy', 'Function', 'Boolean', 'RegExp',
  'globalThis', 'window', 'document', 'console', 'List', 'Dict', 'Optional',
  'Collections', 'Arrays', 'Objects', 'Stream', 'Task', 'Enumerable', 'Convert',
  'Guid', 'DateTime', 'TimeSpan', 'Path', 'Regex', 'Guard', 'nameof', 'fmt',
  'errors', 'serverLog', 'i18n'
);

const SYSTEM_EXCEPTIONS = words(
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError',
  'URIError', 'AggregateError', 'Exception', 'RuntimeException', 'IllegalArgumentException',
  'IllegalStateException', 'NullPointerException', 'IndexOutOfBoundsException',
  'UnsupportedOperationException', 'ArgumentException', 'ArgumentNullException',
  'ArgumentOutOfRangeException', 'InvalidOperationException', 'NotImplementedException',
  'NotSupportedException', 'ValueError', 'KeyError', 'IndexError', 'RuntimeError',
  'NotImplementedError', 'AssertionError', 'StopIteration', 'InterruptedException',
  'IOException', 'FileNotFoundException', 'ClassNotFoundException', 'NoSuchElementException',
  'NumberFormatException', 'TimeoutException', 'OperationCanceledException',
  'TaskCanceledException', 'ObjectDisposedException', 'FormatException',
  'OverflowException', 'DivideByZeroException', 'JsonException', 'SerializationException'
);

// Database operation vocabulary
const READ_OPS = words(
  'find', 'findone', 'findall', 'findbyid', 'findbypk', 'findmany', 'findfirst',
  'findunique', 'get', 'getone', 'getmany', 'getall', 'getbyid', 'getasync',
  'list', 'count', 'countdocuments', 'aggregate', 'select', 'query', 'queryrow',
  'scalar', 'first', 'firstordefaultasync', 'single', 'singleordefaultasync',
  'last', 'all', 'any', 'exists', 'tolist', 'toarray', 'filter', 'where',
  'fetch', 'fetchone', 'fetchall', 'fetchmany', 'load', 'read', 'scan',
  'search', 'paginate', 'pluck', 'distinct', 'values', 'values_list', 'iterator',
  'stream', 'one', 'one_or_none', 'scalars', 'find_by', 'find_each', 'objects',
  'preload', 'take', 'limit', 'offset', 'skip', 'raw', 'get_object_or_404',
  'retrieve', 'show', 'lookup', 'refresh', 'opsforvalue', 'table'
);

const WRITE_OPS = words(
  'create', 'createmany', 'update', 'updateone', 'updatemany', 'upsert',
  'delete', 'deleteone', 'deletemany', 'destroy', 'save', 'savechangesasync',
  'insert', 'insertmany', 'remove', 'add', 'addasync', 'persist', 'merge',
  'flush', 'commit', 'bulkcreate', 'bulkwrite', 'put', 'set', 'exec',
  'execute', 'truncate', 'drop', 'get_or_create', 'update_or_create',
  'delete_all', 'update_all', 'insert_all', 'rollback', 'transaction',
  'begin', 'clear', 'reset', 'store', 'migrate', 'reindex', 'rebuild',
  'upserttopics'
);

const DB_ROOTS = words(
  'prisma', 'db', 'database', 'orm', 'em', 'entitymanager', 'datasource',
  'queryrunner', 'knex', 'kysely', 'sequelize', 'mongoose', 'drizzle',
  'sql', 'pool', 'pg', 'pgclient', 'conn', 'connection', 'repo',
  'repository', 'collection', 'trx', 'tx', 'typeorm', 'dbclient',
  'mongo', 'mongoclient', 'session', 'engine', 'cursor', 'jdbctemplate',
  'namedparameterjdbctemplate', 'mongotemplate', 'databaseclient',
  'dbcontext', 'context', '_context'
);

const DB_SUFFIXES = [
  'repository', 'repo', 'dao', 'mapper', 'entitymanager', 'datasource',
  'dbcontext', 'dbset', 'model', 'entity', 'collection', 'table', 'database'
];

// Pre-sorted suffixes and prefix arrays for bounded, allocation-free checks
const SORTED_DB_SUFFIXES = Object.freeze([...DB_SUFFIXES].sort((a, b) => b.length - a.length));
const READ_OP_PREFIXES = Object.freeze([...READ_OPS].filter((op) => op.length >= 4));
const WRITE_OP_PREFIXES = Object.freeze([...WRITE_OPS].filter((op) => op.length >= 4));

// Framework response vocabulary per language family
const RESPONSE: Readonly<Record<Family, ReadonlySet<string>>> = {
  js: words(
    'json', 'jsonp', 'send', 'sendstatus', 'status', 'code', 'end',
    'redirect', 'render', 'sendfile', 'download', 'write', 'writehead',
    'body', 'text', 'html', 'notfound', 'stream', 'file', 'view',
    'throw', 'assert', 'nextresponse', 'response', 'httperror'
  ),
  py: words(
    'httpexception', 'jsonresponse', 'redirectresponse', 'streamingresponse',
    'fileresponse', 'htmlresponse', 'plaintextresponse', 'orjsonresponse',
    'jsonify', 'abort', 'make_response', 'redirect', 'render_template',
    'send_file', 'send_from_directory', 'httpresponse', 'http404', 'render',
    'get_object_or_404', 'get_list_or_404'
  ),
  jvm: words('responseentity', 'responsestatusexception', 'serverresponse'),
  cs: words(
    'ok', 'notfound', 'badrequest', 'created', 'createdataction', 'createdatroute',
    'nocontent', 'unauthorized', 'forbid', 'accepted', 'problem', 'statuscode',
    'conflict', 'unprocessableentity', 'redirect', 'view', 'json', 'file',
    'content', 'challenge', 'signin', 'signout', 'validationproblem', 'page'
  ),
  go: words(
    'json', 'indentedjson', 'purejson', 'asciijson', 'securejson', 'jsonp',
    'xml', 'yaml', 'toml', 'protobuf', 'string', 'html', 'data', 'file',
    'redirect', 'render', 'status', 'abortwithstatus', 'abortwithstatusjson',
    'abortwitherror', 'error', 'sendstring', 'sendstatus', 'send', 'nocontent',
    'writeheader'
  ),
  c: new Set<string>(),
  rb: words(
    'render', 'redirect_to', 'redirect_back', 'head', 'respond_to',
    'respond_with', 'send_data', 'send_file', 'render_to_string'
  ),
  php: words('response', 'abort', 'abort_if', 'abort_unless', 'redirect', 'view', 'back', 'json'),
  swift: words('abort', 'response', 'redirect'),
  rs: words('httpresponse', 'json', 'statuscode', 'redirect', 'namedfile', 'httpresponsebuilder'),
};

// Queue & background workers
const QUEUE_ROOTS = words(
  'queue', 'emailqueue', 'rabbittemplate', 'kafkatemplate',
  'applicationeventpublisher', 'bus', '_bus', 'publishendpoint',
  '_publishendpoint', 'backgroundjob', 'workmanager', 'producer'
);
const QUEUE_OPS = words(
  'add', 'send', 'publish', 'publishevent', 'convertandsend',
  'enqueue', 'enqueueuniquework', 'produce', 'delay', 'perform_later'
);

// Email & notifications
const EMAIL_ROOTS = words(
  'mailer', 'transporter', 'mailerservice', 'mailsender',
  'emailsender', '_emailsender', 'resend', 'usermailer', 'mail'
);
const EMAIL_OPS = words('sendmail', 'send', 'sendemailasync', 'send_mail', 'welcome', 'to');

// Cache & key-value stores
const CACHE_ROOTS = words(
  'cache', 'cachemanager', 'redis', 'redisclient',
  'redistemplate', '_cache', 'memcached', 'upstash'
);
const CACHE_OPS = words(
  'get', 'set', 'setex', 'delete', 'del', 'remove',
  'incr', 'decr', 'expire', 'exists', 'opsforvalue', 'getorcreateasync'
);

// Authentication & cryptography
const AUTH_ROOTS = words(
  'jwt', 'jwtservice', 'bcrypt', 'argon2', 'passwordencoder',
  'usermanager', 'signinmanager', 'pwd_context', 'crypto',
  'jose', 'secrets', 'hmac'
);
const AUTH_OPS = words(
  'encode', 'decode', 'verify', 'sign', 'signasync', 'compare',
  'hash', 'createhmac', 'passwordsigninasync', 'createasync', 'newwithclaims'
);

// Storage & filesystems
const STORAGE_ROOTS = words(
  'asyncstorage', 'localstorage', 'sessionstorage', 'fs', 'filesystem',
  'files', 'file', 's3', 'os', 'sharedpreferences', 'userpreferences'
);
const STORAGE_OPS = words(
  'setitem', 'getitem', 'writefile', 'readfile', 'write', 'read',
  'putobject', 'getobject', 'upload_file', 'download_file', 'open',
  'fopen', 'fprintf', 'updatedata', 'edit'
);

// System process spawning
const PROCESS_ROOTS = words('process', 'subprocess', 'child_process', 'exec', 'runtime');
const PROCESS_OPS = words('spawn', 'exec', 'execfile', 'fork', 'run', 'command', 'exit', 'abort', 'kill', 'pthread_create', 'system');

// Network clients & HTTP
const NETWORK_ROOTS = words(
  'client', 'httpclient', '_httpclient', 'http', 'https', 'fetch',
  'axios', 'requests', 'httpx', 'resttemplate', 'webclient',
  'urlsession', 'socket', 'curl_easy_perform'
);
const NETWORK_OPS = words(
  'get', 'post', 'put', 'patch', 'delete', 'request', 'getasync',
  'postasync', 'getforobject', 'data', 'datatask', 'do', 'connect',
  'send', 'open', 'asyncclient'
);

// Mobile & desktop device APIs
const DEVICE_ROOTS = words('linking', 'alert', 'camera', 'location', 'notifications', 'clipboard', 'haptics', 'share', 'appstate');
const DEVICE_OPS = words('openurl', 'alert', 'prompt', 'requestpermissionsasync', 'getcurrentpositionasync', 'setstring', 'impactasync', 'share');

// Observability, logging & telemetry
const TELEMETRY_ROOTS = words('ddrum', 'sentry', 'analytics', 'telemetry', 'telemetryclient', 'logger', 'metrics');
const TELEMETRY_OPS = words('addaction', 'captureexception', 'capturemessage', 'track', 'trackevent', 'record', 'increment', 'observe');

const MODIFIER_PREFIX_RE = /^(?:readonly|private|public|protected|final|static)\s+/;
const LEADING_UNDERSCORES_RE = /^_+/;
const UPPERCASE_START_RE = /^[A-Z]/;
const TRAILING_SPECIAL_CHAR_RE = /[!?]$/;
const GENERICS_TAG_RE = /<[^<>]+>/g;

function familyOf(language: Language | null | undefined): Family | null {
  if (!language) return null;
  for (const [family, members] of Object.entries(LANGUAGE_FAMILIES) as Array<[Family, ReadonlySet<Language>]>) {
    if (members.has(language)) return family;
  }
  return null;
}

export function normaliseCall(text: string): string {
  let out = text.trim();
  for (const prefix of ['await ', 'new ', 'yield ', 'return ', 'throw ']) {
    if (out.startsWith(prefix)) {
      out = out.slice(prefix.length).trimStart();
    }
  }
  return out.replaceAll('?.', '.').replaceAll('!.', '.').replaceAll(' ', '');
}

function withoutArguments(text: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '(') {
      depth++;
      continue;
    }
    if (char === ')') {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) {
      out += char;
    }
  }
  return out;
}

function shapeOf(input: Pick<EffectInput, 'text' | 'kind' | 'language'>): CallShape | null {
  const normalized = withoutArguments(normaliseCall(input.text));
  if (!normalized) return null;

  const stripped = normalized.replace(GENERICS_TAG_RE, '');
  const segments = stripped.split(/::|\./).filter(Boolean);
  if (segments.length === 0) return null;

  const lower = segments.map((seg) => seg.replace(TRAILING_SPECIAL_CHAR_RE, '').toLowerCase());
  return {
    normalized,
    segments,
    lower,
    first: lower[0]!,
    last: lower[lower.length - 1]!,
    family: familyOf(input.language),
  };
}

function receiver(shape: CallShape): string {
  const startIndex = shape.first === 'this' || shape.first === 'self' ? 1 : 0;
  const token = shape.lower[startIndex] ?? shape.first;
  return token.replace(LEADING_UNDERSCORES_RE, '');
}

function hasSuffix(value: string, suffixes: readonly string[]): boolean {
  const clean = value.replace(LEADING_UNDERSCORES_RE, '').toLowerCase();
  for (let i = 0; i < suffixes.length; i++) {
    if (clean.endsWith(suffixes[i]!)) return true;
  }
  return false;
}

function matchOp(op: string, exactSet: ReadonlySet<string>, prefixes: readonly string[]): boolean {
  if (exactSet.has(op)) return true;
  for (let i = 0; i < prefixes.length; i++) {
    if (op.startsWith(prefixes[i]!)) return true;
  }
  return false;
}

function databaseEvidence(shape: CallShape, type: string | null | undefined): boolean {
  const recv = receiver(shape);
  const cleanType = type ? type.replace(MODIFIER_PREFIX_RE, '').trim() : '';
  const isRead = matchOp(shape.last, READ_OPS, READ_OP_PREFIXES);
  const isWrite = matchOp(shape.last, WRITE_OPS, WRITE_OP_PREFIXES);

  if (!isRead && !isWrite) return false;

  if (DB_ROOTS.has(recv) || hasSuffix(recv, DB_SUFFIXES) || hasSuffix(cleanType, DB_SUFFIXES)) {
    return true;
  }
  if (shape.lower.includes('objects') || shape.lower.includes('session')) {
    return true;
  }
  if (UPPERCASE_START_RE.test(shape.segments[0] ?? '') && ['js', 'py', 'rb', 'php', 'swift'].includes(shape.family ?? '')) {
    return true;
  }
  if (['swift', 'rb'].includes(shape.family ?? '') && ['save', 'query'].includes(shape.last) && shape.segments.length > 1) {
    return true;
  }
  return shape.family === 'go' && recv === 'db';
}

function stripSuffix(value: string): string {
  const clean = value.replace(LEADING_UNDERSCORES_RE, '');
  const lower = clean.toLowerCase();
  for (let i = 0; i < SORTED_DB_SUFFIXES.length; i++) {
    const suffix = SORTED_DB_SUFFIXES[i]!;
    if (lower.endsWith(suffix)) {
      return clean.slice(0, -suffix.length) || clean;
    }
  }
  return clean;
}

function modelOf(shape: CallShape, type: string | null | undefined): string | null {
  const cleanType = type ? type.replace(MODIFIER_PREFIX_RE, '').trim() : '';
  if (cleanType && hasSuffix(cleanType, DB_SUFFIXES)) {
    return stripSuffix(cleanType);
  }

  const startIndex = shape.first === 'this' || shape.first === 'self' ? 1 : 0;
  const rawReceiver = shape.segments[startIndex] ?? '';
  const lowerReceiver = rawReceiver.toLowerCase();

  if (lowerReceiver === 'prisma' && shape.segments[startIndex + 1]) {
    return shape.segments[startIndex + 1]!;
  }
  if (['context', '_context', 'dbcontext'].includes(lowerReceiver) && shape.segments[startIndex + 1]) {
    const candidate = shape.segments[startIndex + 1]!;
    const lowerCandidate = candidate.toLowerCase();
    if (!READ_OPS.has(lowerCandidate) && !WRITE_OPS.has(lowerCandidate)) {
      return candidate;
    }
  }
  if (hasSuffix(rawReceiver, DB_SUFFIXES)) {
    return stripSuffix(rawReceiver);
  }
  if (UPPERCASE_START_RE.test(rawReceiver) && !DB_ROOTS.has(lowerReceiver)) {
    return rawReceiver;
  }
  return null;
}

function databaseEffect(shape: CallShape, type: string | null | undefined): Effect {
  const result: Effect = { category: 'database' };
  const model = modelOf(shape, type);
  if (model) result.model = model;

  if (shape.family === 'py' && shape.last === 'exec') {
    result.access = 'read';
  } else if (matchOp(shape.last, WRITE_OPS, WRITE_OP_PREFIXES)) {
    result.access = 'write';
  } else if (matchOp(shape.last, READ_OPS, READ_OP_PREFIXES)) {
    result.access = 'read';
  }
  return result;
}

function isResponse(shape: CallShape): boolean {
  if (!shape.family) return false;
  const allowed = RESPONSE[shape.family];
  const recv = receiver(shape);

  if (shape.family === 'js') {
    if (['res', 'response', 'reply', 'rep', 'ctx', 'c', 'context', 'nextresponse'].includes(recv)) {
      return allowed.has(shape.last);
    }
    return allowed.has(shape.first) && shape.segments.length === 1;
  }
  if (allowed.has(shape.first) && shape.segments.length === 1) {
    return true;
  }
  if (shape.family === 'jvm' && recv === 'responseentity') {
    return true;
  }
  if (shape.family === 'cs' && ['results', 'typedresults'].includes(recv)) {
    return true;
  }
  if (shape.family === 'go' && ['c', 'ctx', 'g', 'w', 'rw', 'res', 'writer', 'http'].includes(recv)) {
    return allowed.has(shape.last);
  }
  return allowed.has(shape.last) && shape.segments.length === 1;
}

function responseConstructor(shape: CallShape, project: ProjectKind): boolean {
  if (project === 'app') return false;
  const name = shape.segments[shape.segments.length - 1] ?? '';
  const lowerName = name.toLowerCase();

  if (SYSTEM_EXCEPTIONS.has(lowerName)) return false;
  if (['httpexception', 'responsestatusexception', 'httpresponse', 'abort'].includes(shape.last)) {
    return true;
  }
  return (
    lowerName.endsWith('exception') ||
    lowerName.endsWith('httperror') ||
    lowerName.endsWith('apierror') ||
    lowerName.endsWith('errorresponse') ||
    (lowerName.endsWith('error') && statusName(name) !== null)
  );
}

function rootOp(shape: CallShape, roots: ReadonlySet<string>, ops: ReadonlySet<string>): boolean {
  const recv = receiver(shape);
  const hasRoot = roots.has(recv) || shape.lower.some((token) => roots.has(token));
  return hasRoot && (ops.has(shape.last) || [...ops].some((op) => op.length >= 4 && shape.last.startsWith(op)));
}

export function classifyEffect(input: EffectInput): Effect | null {
  const shape = shapeOf(input);
  if (!shape) return null;

  if (shape.first === 'process' && PROCESS_OPS.has(shape.last)) {
    return { category: 'process' };
  }
  if (RUNTIME_ROOTS.has(shape.first)) {
    return null;
  }
  if (input.kind === 'instantiates') {
    return responseConstructor(shape, input.project ?? 'app') ? { category: 'response' } : null;
  }
  if (input.language && !shape.family) {
    if (input.receiverType && TELEMETRY_ROOTS.has(input.receiverType.toLowerCase())) {
      return { category: 'telemetry' };
    }
    return null;
  }

  if (databaseEvidence(shape, input.receiverType)) {
    return databaseEffect(shape, input.receiverType);
  }
  if (isResponse(shape)) {
    return { category: 'response' };
  }
  if (rootOp(shape, QUEUE_ROOTS, QUEUE_OPS) || ['delay', 'perform_later'].includes(shape.last)) {
    return { category: 'queue' };
  }
  if (rootOp(shape, EMAIL_ROOTS, EMAIL_OPS) || shape.first === 'send_mail') {
    return { category: 'email' };
  }
  if (shape.lower.includes('stripe')) {
    return { category: 'payments' };
  }
  if (rootOp(shape, CACHE_ROOTS, CACHE_OPS)) {
    return { category: 'cache' };
  }
  if (rootOp(shape, AUTH_ROOTS, AUTH_OPS)) {
    return { category: 'auth' };
  }
  if (
    (shape.family === 'py' && shape.first === 'open') ||
    rootOp(shape, STORAGE_ROOTS, STORAGE_OPS) ||
    (shape.family === 'c' && STORAGE_OPS.has(shape.first))
  ) {
    return { category: 'storage' };
  }
  if (PROCESS_OPS.has(shape.first) || rootOp(shape, PROCESS_ROOTS, PROCESS_OPS)) {
    return { category: 'process' };
  }
  if (
    (NETWORK_ROOTS.has(shape.first) && (shape.segments.length === 1 || NETWORK_OPS.has(shape.last))) ||
    rootOp(shape, NETWORK_ROOTS, NETWORK_OPS) ||
    (shape.family === 'c' && ['socket', 'connect', 'curl_easy_perform'].includes(shape.first))
  ) {
    return { category: 'network' };
  }
  if (rootOp(shape, DEVICE_ROOTS, DEVICE_OPS)) {
    return { category: 'device' };
  }
  if (rootOp(shape, TELEMETRY_ROOTS, TELEMETRY_OPS) || (input.receiverType && TELEMETRY_ROOTS.has(input.receiverType.toLowerCase()))) {
    return { category: 'telemetry' };
  }
  return null;
}

const STATUS: ReadonlyMap<string, number> = new Map([
  ['ok', 200], ['success', 200], ['created', 201], ['accepted', 202],
  ['nocontent', 204], ['movedpermanently', 301], ['found', 302],
  ['redirect', 302], ['seeother', 303], ['notmodified', 304],
  ['temporaryredirect', 307], ['permanentredirect', 308],
  ['badrequest', 400], ['unauthorized', 401], ['unauthenticated', 401],
  ['paymentrequired', 402], ['forbidden', 403], ['forbid', 403],
  ['notfound', 404], ['methodnotallowed', 405], ['notacceptable', 406],
  ['requesttimeout', 408], ['conflict', 409], ['gone', 410],
  ['preconditionfailed', 412], ['payloadtoolarge', 413],
  ['unsupportedmediatype', 415], ['imateapot', 418],
  ['unprocessableentity', 422], ['unprocessable', 422],
  ['toomanyrequests', 429], ['throttled', 429],
  ['internalservererror', 500], ['internalerror', 500],
  ['servererror', 500], ['notimplemented', 501], ['badgateway', 502],
  ['serviceunavailable', 503], ['gatewaytimeout', 504],
  ['validationproblem', 400], ['problem', 500],
  ['challenge', 401], ['entitynotfound', 404]
]);

const STATUS_SUFFIX_RE = /(?:Exception|Error|Response|Result|Async|Status|Code)$/g;
const HTTP_PREFIX_RE = /^Http(?=[A-Z0-9])/;
const NON_ALPHANUMERIC_RE = /[^A-Za-z0-9]/g;
const NUMERIC_HTTP_RE = /^(?:http)?([1-5]\d{2})$/;
const THREE_DIGIT_STATUS_RE = /^[1-5]\d{2}$/;
const KEY_VALUE_SPLIT_RE = /\s*[=:]\s*/;

function statusName(value: string): number | null {
  const dotted = value.trim().split('.').filter(Boolean);
  let token = dotted[dotted.length - 1] ?? value;
  token = token.replace(STATUS_SUFFIX_RE, '').replace(HTTP_PREFIX_RE, '');
  const key = token.replace(NON_ALPHANUMERIC_RE, '').toLowerCase();

  const numeric = NUMERIC_HTTP_RE.exec(key);
  if (numeric) return Number(numeric[1]);

  const exact = STATUS.get(key);
  if (exact !== undefined) return exact;

  for (const [name, code] of STATUS) {
    if (name.length >= 6 && key.endsWith(name)) return code;
  }
  return null;
}

function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let token = '';
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!;
    if ('([{'.includes(ch)) {
      depth++;
    } else if (')] }'.includes(ch)) {
      depth = Math.max(0, depth - 1);
    }
    if (ch === ',' && depth === 0) {
      out.push(token.trim());
      token = '';
    } else {
      token += ch;
    }
  }
  if (token.trim()) out.push(token.trim());
  return out;
}

function literalStatus(value: string): number | null {
  const token = value.trim();
  if (THREE_DIGIT_STATUS_RE.test(token)) return Number(token);
  return statusName(token);
}

function inlineStatus(text: string): number | null {
  const setters = [
    'status', 'sendStatus', 'code', 'Status',
    'StatusCode', 'SendStatus', 'withStatus', 'with_status'
  ];
  for (let i = 0; i < setters.length; i++) {
    const marker = `${setters[i]!}(`;
    const start = text.indexOf(marker);
    if (start < 0) continue;
    const rest = text.slice(start + marker.length);
    const end = rest.indexOf(')');
    if (end < 0) continue;
    const status = literalStatus(rest.slice(0, end));
    if (status !== null) return status;
  }
  return null;
}

export function responseStatus(
  text: string,
  args: string | null | undefined,
  kind: 'calls' | 'instantiates' = 'calls'
): number | null {
  const call = normaliseCall(text);
  const inline = inlineStatus(call);
  if (inline !== null) return inline;

  const shape = shapeOf({ text, kind });
  if (!shape) return null;

  const parts = splitArgs(args ?? '');
  const statusMethods = words(
    'status', 'sendstatus', 'code', 'abort', 'statuscode',
    'writeheader', 'string', 'data', 'json', 'abortwithstatus',
    'abortwithstatusjson', 'error', 'redirect', 'head', 'problem'
  );

  if (statusMethods.has(shape.last)) {
    const ordered = ['error', 'redirect'].includes(shape.last) ? [...parts].reverse() : parts;
    for (let i = 0; i < ordered.length; i++) {
      const status = literalStatus(ordered[i]!);
      if (status !== null) return status;
    }
    if (shape.last === 'redirect') return 302;
    if (shape.last === 'problem' || shape.last === 'error') return 500;
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const assignment = part.split(KEY_VALUE_SPLIT_RE, 2);
    if (assignment.length === 2 && ['status', 'status_code', 'statuscode', 'code'].includes(assignment[0]!.toLowerCase())) {
      const status = literalStatus(assignment[1]!);
      if (status !== null) return status;
    }
    const status = literalStatus(part);
    if (status !== null && (kind === 'instantiates' || shape.last === 'httpexception' || shape.last === 'abort')) {
      return status;
    }
  }

  for (let i = shape.segments.length - 1; i >= 0; i--) {
    const segment = shape.segments[i]!;
    if (['json', 'send', 'body', 'build', 'res', 'response', 'reply', 'c', 'this'].includes(segment.toLowerCase())) {
      continue;
    }
    const status = statusName(segment);
    if (status !== null) return status;
    break;
  }

  if (
    [
      'redirect', 'redirect_to', 'redirectresponse', 'httpresponseredirect',
      'redirecttoaction', 'redirecttopage', 'redirecttoroute', 'localredirect'
    ].includes(shape.last)
  ) {
    return 302;
  }
  if (['created', 'createdataction', 'createdatroute'].includes(shape.last)) {
    return 201;
  }
  return null;
}

export function implicitResponseStatus(text: string): number | null {
  const call = normaliseCall(text);
  const setters = [
    'status(', 'sendStatus(', 'code(', 'Status(',
    'StatusCode(', 'withStatus(', 'with_status(', 'writeHead('
  ];
  for (let i = 0; i < setters.length; i++) {
    if (call.includes(setters[i]!)) return null;
  }

  const shape = shapeOf({ text, kind: 'calls' });
  if (!shape) return null;

  const bodySendingOps = words(
    'json', 'jsonp', 'send', 'render', 'sendfile', 'download',
    'text', 'html', 'body', 'stream', 'file', 'view',
    'jsonresponse', 'htmlresponse', 'plaintextresponse',
    'orjsonresponse', 'jsonify', 'render_template', 'make_response',
    'httpresponse', 'respond_with'
  );

  return bodySendingOps.has(shape.last) ? 200 : null;
}

export function categoryWord(category: string): string {
  return category;
}
