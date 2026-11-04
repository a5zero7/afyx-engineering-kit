/**
 * Deterministic input corpus for the search behavior contract.
 * Everything here is generated from fixed lists (no randomness), so the same
 * inputs are replayed against any implementation of the search modules.
 */

const WORDS = ['user', 'service', 'cache', 'builder', 'http', 'parser', 'order', 'state', 'machine', 'base64', 'encode', 'scrape', 'loop', 'get', 'name', 'id', 'xml', 'html', 'api', 'config'];

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

function styled(parts: string[]): string[] {
  return [
    parts[0] + parts.slice(1).map(cap).join(''),
    parts.map(cap).join(''),
    parts.join('_'),
    parts.join('_').toUpperCase(),
    parts.join('-'),
    parts.join('.'),
    parts.map((part, index) => (index % 2 ? part.toUpperCase() : part)).join(''),
  ];
}

const HANDWRITTEN_IDENTIFIERS = [
  '', ' ', 'a', 'ab', 'HTMLParser', 'parseHTMLString', 'XMLHttpRequest', 'getHTTPResponse', 'OrderStateMachine',
  'base64Encode', 'utf8Decode', 'IOError', 'iOSVersion', 'A1B2', '12345', 'v2', 'x_', '_x', '__init__', '__proto__',
  'SCREAMING_SNAKE_CASE', 'kebab-case-name', 'dotted.file.name', 'file.test.ts', 'a.b', 'a-b', 'a_b', 'aB', 'Ab', 'AB', 'ABc',
  'scrapeLoop', 'UserService', 'getCallGraph', 'resolveDeferredThisMemberRefs', 'writeConfig', 'ÉtatCommande', 'résolutionDesRéférences',
  'naïveBayes', 'straße', 'ΑλφαΒήτα', '日本語Name', 'имяПользователя', 'x'.repeat(40), 'aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPq',
  'oneTwoThreeFourFiveSixSevenEightNineTenElevenTwelveThirteenFourteen', 'FLAT', 'Screen', 'setLastEmail', 'OrgUserStore', 'REST', 'HTTP',
  'con-fig', 'foo::bar', 'foo->bar', 'std::vector', '$scope', '@Component', '#include', 'a/b/c', 'C:\\path\\file', "quote's", '"quoted"',
  'tab\tsep', 'new\nline', 'emoji😀name', 'zero0', '0zero', 'Ünïcödé', 'ǅungla', 'İstanbul', 'ﬁle',
];

export const IDENTIFIERS: string[] = (() => {
  const out = [...HANDWRITTEN_IDENTIFIERS];
  for (let i = 0; i < WORDS.length; i++) {
    out.push(...styled([WORDS[i]!, WORDS[(i + 3) % WORDS.length]!]));
    if (i % 2 === 0) out.push(...styled([WORDS[i]!, WORDS[(i + 5) % WORDS.length]!, WORDS[(i + 9) % WORDS.length]!]));
  }
  return out;
})();

export const PROSE: string[] = [
  '', '   ', 'comment marche la state machine des commandes ?', 'how does the order state machine work',
  'fix THIS typo', 'WRITE a haiku', 'rename this file please', "there's an issue with the cache builder",
  'références et résolution des dépendances', 'Wie funktioniert die Bestellung', 'auto-scroll to bottom, atBottom tracking',
  'services machines cookies classes boxes hashes quizzes patches caches lenses databases heroes shoes process class',
  'the quick brown fox jumps over the lazy dog and keeps running through parsers',
  '日本語の文章はスペースなしで続きます', 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp qqqq rrrr ssss',
  '12345 67890 numbers only 2024 2025', 'a ab abc abcd abcde', 'x'.repeat(30) + ' ' + 'y'.repeat(20),
  'calculateInvoiceTotal and OrderStateMachine plus base64Encode', 'snake_case_words and kebab-case-words together',
  'ÉCOLE Élève café naïve coöperate', 'What is happening when eviction management handles caching?',
];

const FILTERED = [
  'kind:function name:auth path:src/api authenticate', 'kind:class', 'kind:nonsense foo', 'KIND:Function', 'lang:python', 'language:TypeScript',
  'lang:klingon x', 'path:"src/some path/with spaces" run', 'path:"unterminated quote rest of input', '"leading quote" name:x', 'name:', ':value',
  'foo:bar', 'TODO: fix', 'kind:function kind:method name:a name:b', 'path:a path:b', 'http://example.com/x', 'a:b:c', 'kind:"function"',
  '   spaced    out   ', 'constructor:x __proto__:y toString:z hasOwnProperty:a', 'path:""', 'name:"x y"', 'kind:function\tname:tab', 'lang:go path:cmd/ server',
];

const PATH_LIKE = [
  'the scroll logic in src/routes/m/projects/[id]/runs/[runId]/+page.svelte', 'see chat-manager.ts and background-image-table', 'open (src/foo.ts).',
  'src/foo.ts:123 and src/foo.ts:12-40 and src/foo.ts#L88', 'and/or gen_server:call/2 non-blocking', 'Class.method app.isPackaged', '/Users/dev/repo/src/app/main.ts',
  './src//nested///file.ts/', 'C:\\repo\\src\\win.ts', '`src/quoted.ts`', '<src/angle.ts>', '(protected)/dashboard/page.tsx', 'pre-commit hook', 'README.md', '+page.svelte',
  'a.b.c.d.e.f.g.h.i.j', 'x/y', '-flag --other-flag', 'foo-bar', 'one two three four five six seven eight nine ten src/a.ts src/b.ts',
  'src/one.ts src/two.ts src/three.ts src/four.ts src/five.ts src/six.ts src/seven.ts src/eight.ts src/nine.ts src/ten.ts',
  'src/missing/nowhere.ts', 'deep/er/est/path/that/does/not/exist/anywhere/file.ts', 'lib/Util.TS', 'SRC/UTIL/HELPERS.TS', 'data-table.module.scss', 'data-table',
];

const DEEP_PATH_QUERIES = [6, 7, 8, 9].map((junk) => `${Array.from({ length: junk }, (_, index) => `j${index}`).join('/')}/x/y/deep.ts`);

const NATURAL = [
  'how is caching implemented', 'where does the eviction happen', 'scrapeLoop and UserService', 'getUserName from get_user_name.py', 'handler builder manager',
  'error handling in the parser', 'test coverage for cache', 'spec for the order service', 'MyApp backend routes', 'SuperBizAgent controller', 'HTTP2 xml_parser.v2',
  'process classes', 'a', 'ab', 'abc', '   ', '', 'CacheBuilder build', 'Pod', 'PodGCControllerOptions', 'cache builder', 'Cache-Builder', 'cache.builder',
  'entries processed handled propagated carried', 'running getter builder handler', 'management expression', 'flat object', 'REST api', 'x'.repeat(50),
];

export const QUERIES: string[] = [...FILTERED, ...PATH_LIKE, ...DEEP_PATH_QUERIES, ...NATURAL, ...PROSE];

export const NODE_NAMES: string[] = IDENTIFIERS.filter((_, index) => index % 3 === 0).slice(0, 70);

/** Queries derived from a symbol name, so the name-match branches (exact, prefix, token, substring) all fire. */
export function nameDerivedQueries(name: string): string[] {
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' ');
  return [name, name.toLowerCase(), name.slice(0, Math.max(1, Math.ceil(name.length / 2))), `${name} extra`, `other ${name}`, spaced, name.slice(1, -1) || name];
}

const DIRS = ['', 'src', 'lib', 'app', 'tests', 'test', '__tests__', 'spec', 'specs', 'e2e', 'examples', 'samples', 'fixtures', 'benchmark', 'benchmarks', 'demo', 'demos', 'sample', 'example', 'fixture', 'integration',
  'core/data/src/main/kotlin/com/google/samples/apps', 'app/jvmTest', 'app/commonTest', 'pkg/testdata', 'pkg/mocks', 'pkg/__mocks__', 'pkg/Testing', 'core/data-test', 'node_modules/x',
  'src/test/java', 'src/examples', 'Examples/src', 'a/b/c/d'];

const FILES = ['UserService.ts', 'user_service.py', 'user.test.ts', 'user_test.go', 'UserServiceTest.java', 'UserSpec.scala', 'test_user.py', 'latest.kt', 'manifest.kt', 'index.ts',
  'README.md', 'service.spec.rb', 'FooTests.swift', 'BazTestCase.cs', 'test.js', 'my-spec.rb', 'a_specs.py', 'Makefile', '.hidden', 'noext'];

export const PATHS: string[] = (() => {
  const out: string[] = [];
  for (const dir of DIRS) for (const file of FILES) out.push(dir ? `${dir}/${file}` : file);
  for (const dir of DIRS) if (dir) for (const file of FILES) out.push(`pkg/${dir}/${file}`);
  out.push('/abs/tests/x.ts', '/abs/src/sample/x.ts', 'Tests/X.ts', 'TEST/x.ts', 'foo/latest/x.kt', 'foo/manifest/x.kt', 'jvmTest/A.kt', 'x/jvmtest/A.kt');
  return out;
})();

const PRODUCTION_DIRS = ['', 'src', 'lib', 'app', 'a/b/c/d', 'src/user/service', 'packages/cache-builder/src'];
const PRODUCTION_FILES = ['UserService.ts', 'user_service.py', 'index.ts', 'README.md', 'cache_builder.go', 'CacheBuilder.java', 'html-parser.rs', 'data-table.tsx', 'Makefile', 'get_user_name.py'];

export const SCORING_PATHS: string[] = [
  ...PATHS.filter((_, index) => index % 5 === 0),
  ...PRODUCTION_DIRS.flatMap((dir) => PRODUCTION_FILES.map((file) => (dir ? `${dir}/${file}` : file))),
];

export const SCORING_QUERIES: string[] = [
  'user service', 'UserService', 'getUserName', 'cache builder', 'test cache', 'spec runner', 'index', 'README', 'MyApp backend routes', 'myproject routes',
  'SuperBizAgent controller', 'src/api', 'data-table', 'A1B2', 'a', '', '   ', 'user_service.py', 'HTMLParser', 'Testing helpers', 'examples sample', 'kotlin samples',
];

export const PROJECT_TOKEN_SETS: Array<string[] | undefined> = [undefined, [], ['myproject', 'userservice'], ['superbizagent', 'myapp']];

export const INDEXED_PATHS: string[] = [
  'src/routes/m/projects/[id]/runs/[runId]/+page.svelte', 'src/routes/m/projects/[id]/+page.svelte', 'src/routes/other/+page.svelte', 'src/chat-manager.ts', 'src/foo.ts',
  'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts', 'src/g.ts', 'src/h.ts', 'src/i.ts', 'src/one.ts', 'src/two.ts', 'src/three.ts', 'src/four.ts',
  'x/y/deep.ts', 'src/five.ts', 'src/six.ts', 'src/seven.ts', 'src/eight.ts', 'src/nine.ts', 'src/ten.ts', 'src/nested/file.ts', 'src/quoted.ts', 'src/angle.ts', 'src/app/main.ts',
  'app/(protected)/dashboard/page.tsx', 'lib/Util.ts', 'lib/util.TS', 'src/util/helpers.ts', 'styles/data-table.module.scss', 'styles/data-table.tsx', 'components/background-image-table.tsx',
  'components/background-image-table.module.css', '.git/hooks/pre-commit', 'README.md', 'docs/README.md', 'pkg/README.md', 'win.ts', 'src/win.ts', 'x/y', 'lib/x/y',
];

export const IDENTIFIER_PAIRS: Array<[string, string]> = (() => {
  const names = IDENTIFIERS.filter((name) => name.length > 1 && name.length < 30).slice(0, 26).map((name) => name.toLowerCase());
  const pairs: Array<[string, string]> = [];
  for (const a of names) for (const b of names) pairs.push([a, b]);
  return pairs;
})();

const BOUNDARY_SUFFIXES = ['ing', 'tion', 'sion', 'ment', 'ies', 'es', 's', 'ed', 'ied', 'eed', 'er', 'ss', 'xes', 'shes', 'sses', 'zzes', 'ches', 'ses', 'zes', 'oes'];
const BOUNDARY_STEMS = ['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'aab', 'abb', 'abbb', 'lookk', 'stopp'];

/** Every suffix rule at every stem length around its length thresholds. */
const BOUNDARY_WORDS: string[] = BOUNDARY_SUFFIXES.flatMap((suffix) => BOUNDARY_STEMS.map((stem) => stem + suffix));

export const STEM_WORDS: string[] = [
  ...BOUNDARY_WORDS,
  'caching', 'handling', 'running', 'eviction', 'expression', 'management', 'entries', 'processes', 'classes', 'errors', 'class', 'handled', 'propagated', 'carried',
  'builder', 'handler', 'getter', 'agreed', 'need', 'sing', 'thing', 'bring', 'string', 'stopping', 'planning', 'sess', 'ties', 'ed', 'er', 'ing', 'tion', 'CACHING', 'Handled',
  'a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg', 'nation', 'session', 'movement', 'agreement', 'bus', 'buses', 'days', 'cities', 'flies', 'dried', 'tried', 'fed',
];

export const KIND_SAMPLES: string[] = ['function', 'method', 'class', 'interface', 'type_alias', 'struct', 'union', 'trait', 'enum', 'component', 'route', 'module', 'property',
  'field', 'variable', 'constant', 'import', 'export', 'parameter', 'namespace', 'file', 'protocol', 'enum_member', 'unknown_kind', '', 'FUNCTION'];

/** Manifest cases for deriveProjectNameTokens: directory name plus optional files. */
export const PROJECT_CASES: Array<{ dir: string; goMod?: string; packageJson?: string }> = [
  { dir: 'plainproject' },
  { dir: 'tiny' },
  { dir: 'My-Cool_App2' },
  { dir: 'x', goMod: 'module github.com/acme/backendservice\n\ngo 1.22\n' },
  { dir: 'y', goMod: '  module   example.org/tools\n' },
  { dir: 'z', goMod: 'go 1.22\n' },
  { dir: 'w', packageJson: JSON.stringify({ name: '@scope/frontend-app' }) },
  { dir: 'v', packageJson: JSON.stringify({ name: 'abcd' }) },
  { dir: 'u', packageJson: '{ not json' },
  { dir: 'tt', packageJson: JSON.stringify({ name: 42 }) },
  { dir: 'both-dirname', goMod: 'module a.b/gomodname\n', packageJson: JSON.stringify({ name: 'pkgjsonname' }) },
];
