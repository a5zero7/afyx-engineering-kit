# Phase 5F — Third-Party Source / Runtime Replacement

Task: `AFYX-91852`
Inventory date: 2026-10-04
Canonical baseline: `ebe34a2b3781c664713a362714ccb92bba2bc8e6`
Branch: `afyx/native-phase5f-parser-grammar`
Status: **COMPLETE — FINAL ARTIFACT AND PRODUCT VIABILITY AUDIT PASSED**

> **Current Phase 5I status (2026-10-09):** Phase 5F artifact/product viability,
> Phase 5G identity eradication, and Phase 5H legal composition remain valid.
> The final audit rebuilt clean dependency-free artifacts and found no new
> third-party or historical payload. Phase 5I is nevertheless `BLOCKED` by
> remaining final cross-platform correctness failures outside this historical
> Phase 5F evidence record. Technical Alpha and Phase 6 are not active.

PR #57 (inventory, utility runtime, and UI runtime) is **MERGED / FROZEN** at
`ebe34a2b3781c664713a362714ccb92bba2bc8e6`.

This document is the Phase 5F technical source of truth. The target is no
third-party product/runtime ownership in the shipped Afyx Graph boundary. It is
not a legal-closure document: historical notices stay intact for Phase 5H.

## Classification rules

| Classification | Meaning in this inventory |
| --- | --- |
| `SHIPPED_RUNTIME` | Executable/runtime redistributed in the release. |
| `SHIPPED_LIBRARY` | Package code installed or bundled for product execution. |
| `SHIPPED_SOURCE` | Third-party source retained in the active product tree. |
| `SHIPPED_ASSET` | Grammar, font, CSS, or other redistributed asset. |
| `EMBEDDED_BROWSER_RUNTIME` | Library/framework code compiled into the viewer. |
| `BUILD_ONLY` | Build dependency whose runtime is not intentionally shipped. |
| `TEST_ONLY` | Test dependency whose runtime is not intentionally shipped. |
| `TOOLCHAIN_EXTERNAL` | CI/build platform outside the product artifact. |
| `EXPLICIT_EXTERNAL_EXCEPTION` | Separately managed product boundary. |
| `HISTORICAL_LEGAL_ONLY` | Retained legal evidence; not evidence of active code by itself. |

Package metadata is not accepted as sole evidence. Classification uses import
sites, generated viewer output, tracked assets/source, and a staged release.

## Baseline product inventory

### Release runtime and Node libraries

The release builder downloads Node `v24.16.0`, copies `node.exe`/`node`, runs
`npm ci --omit=dev` inside staged `lib`, and requires staged `node_modules`.

| Component | Frozen version | Classification | Direct evidence / load site | Replacement requirement |
| --- | --- | --- | --- | --- |
| Node | v24.16.0 | `SHIPPED_RUNTIME` | `scripts/build-bundle.sh`, staged archive root | Host-runtime contract and launcher; no bundled executable. |
| `@clack/prompts` | 1.3.0 | `SHIPPED_LIBRARY` | CLI and installer dynamic imports | Afyx-owned bounded prompts/non-interactive behavior. |
| `commander` | 14.0.3 | `SHIPPED_LIBRARY` | `src/bin/afyx-graph.ts`, `cli-registry.ts` | Afyx CLI grammar preserving commands/options/help/errors. |
| `fast-string-width` | 3.0.2 | `SHIPPED_LIBRARY` | prompt dependency/runtime tree | Afyx terminal width primitive or eliminate the need. |
| `fast-wrap-ansi` | 0.2.0 | `SHIPPED_LIBRARY` | prompt dependency/runtime tree | Afyx output wrapping or eliminate the need. |
| `sisteransi` | 1.0.5 | `SHIPPED_LIBRARY` | prompt dependency/runtime tree | Afyx bounded ANSI helpers or eliminate the need. |
| `ignore` | 7.0.5 | `SHIPPED_LIBRARY` | `src/index.ts`, `src/extraction/index.ts` | Afyx matcher with parity corpus and path normalization. |
| `picomatch` | 4.0.7 | `SHIPPED_LIBRARY` | Cargo workspace resolution | Afyx implementation of only the observed glob subset. |
| `jsonc-parser` | 3.3.1 | `SHIPPED_LIBRARY` | installer targets and workspace resolution | Surgical Afyx JSONC parsing/editing preserving user files. |
| `tree-sitter-wasms` | 0.1.13 | `SHIPPED_LIBRARY` + `SHIPPED_ASSET` | `src/extraction/grammars.ts` | Afyx-owned semantic parser; no grammar package. |
| `web-tree-sitter` | 0.25.10 | `SHIPPED_RUNTIME` + `SHIPPED_LIBRARY` | extraction and branch-guard path | Afyx-owned parsing/fact boundary. |

The staged product contains two additional transitive utility packages:
`@clack/core@1.3.0` and `fast-string-truncated-width@3.0.3`. The actual staged
`node_modules` top-level set is 12 packages. The lockfile has 51 non-dev package
entries because the UI workspace/runtime closure is also represented there.

The root `package.json` and root lock entry currently declare the ten direct
runtime dependencies above. Phase 5F gates both files and the staged tree.

### Browser viewer

| Component | Frozen version | Classification | Actual artifact evidence | Decision |
| --- | --- | --- | --- | --- |
| Svelte | 5.56.10 | `EMBEDDED_BROWSER_RUNTIME` | Compiled viewer JS | Replace with native DOM/browser APIs. |
| `@xyflow/svelte` | 1.6.5 | `EMBEDDED_BROWSER_RUNTIME` | Four graph views and node/edge components | Afyx-owned SVG/DOM graph presentation. |
| `@xyflow/system` and D3-family transitives | lockfile versions | `EMBEDDED_BROWSER_RUNTIME` | Runtime closure bundled by Vite | Removed with XYFlow; no substitute library. |
| Archivo Variable | 5.3.0 | `SHIPPED_ASSET` | Three emitted WOFF2 files | Use platform font stack or Afyx-owned asset. |
| IBM Plex Mono | 5.3.0 | `SHIPPED_ASSET` | Forty emitted WOFF/WOFF2 files | Use platform monospace stack or Afyx-owned asset. |

The before-state viewer has 46 files / 1,077,326 bytes: one HTML file, one
506,225-byte JavaScript bundle, one 100,782-byte CSS bundle, and 43 font files.
Source maps are absent as required by the current distribution verifier. The
viewer must preserve GraphAdapter/wire contracts, Symbol/File/Flow/Map/Screens/
Steps views, navigation, search, and loading/error/empty behavior.

### Parser and grammar assets

`src/extraction/wasm/` contains 29 tracked grammar files totaling 68,192,092
bytes. The staged release contains 68 WASM files totaling 122,348,375 bytes:
the copied Afyx distribution grammar directory plus grammar/runtime WASM from
installed packages. `grammars.ts` loads `web-tree-sitter` and resolves grammar
bytes from the tracked directory or `tree-sitter-wasms`.

The native replacement contract is graph facts, not Tree-sitter AST identity:
definitions, containment, imports/exports, calls/references, type/inheritance
relationships, source ranges, unresolved references, framework facts,
malformed-source behavior, deterministic fresh/incremental convergence.

### Language coverage matrix

All current `LANGUAGES` values and extension/special routing must stay
accounted for. `unknown` is a routing state, not a parser family.

| Family | Languages / formats | Current path | Phase 5F status |
| --- | --- | --- | --- |
| JS/TS | TypeScript, TSX, JavaScript, JSX, ArkTS | Tree-sitter plus specialized extraction | Pending native facts/parser. |
| SFC/template | Svelte, Vue, Astro, Liquid, Razor, Twig | Delegation/format extractors; some TS/JS parsing | Pending native facts/parser; framework behavior frozen. |
| Python/Go/Rust | Python, Go, Rust | Tree-sitter specialized extractors | Pending native facts/parser. |
| JVM | Java, Kotlin, Scala | Tree-sitter specialized extractors | Pending native facts/parser. |
| C family | C, C++, Objective-C, C#, CUDA/Metal routed to C++, Solidity | Tree-sitter specialized extractors | Pending native facts/parser. |
| Dynamic | PHP, Ruby, Swift, Dart, Lua, Luau, R, Nix | Tree-sitter specialized extractors | Pending native facts/parser. |
| Enterprise | Pascal, CFML, CFScript, CFQuery, COBOL, VB.NET, Erlang | Vendored grammar WASM and specialized extraction | Pending native facts/parser. |
| Configuration | Terraform/OpenTofu, YAML, XML, properties | Grammar or file/framework routing | Pending native facts/parser where semantic facts are produced. |
| Special routes | Shopify JSON, Erlang `.app(.src)`, Play `conf/routes` | Filename/content routing | Must remain supported. |

Each family requires positive and malformed/negative fixtures, semantic graph
parity, real-file coverage where available, fresh/incremental convergence, and
a deterministic digest before its old grammar/runtime is removed.

### Optional native kernel

`afyx-graph-kernel` is an active optional product path. `Cargo.lock` contains
74 package entries. Direct dependencies include N-API, Tree-sitter and language
crates, SHA-2, regex, `libc`, `cc`, and `napi-build`. The tracked kernel tree is
52 files / 66,249,394 bytes. Its `grammars/{dart,kotlin,lua,scala}` subtree is
23 files / 65,228,661 bytes of vendored/generated source and licenses.

Classification: dependencies are `SHIPPED_LIBRARY` when the optional binary is
staged; vendored grammars are `SHIPPED_SOURCE`. The controlled Windows bundle
had no kernel binary, but release logic conditionally stages one. Phase 5F must
remove the active optional kernel or replace it without third-party crates,
grammar source, or runtime. Legal files are not removed here.

### Build/test/toolchain inventory

| Component | Classification | Notes |
| --- | --- | --- |
| TypeScript, `@types/*` | `BUILD_ONLY` | Compiler/types; no intended product runtime. |
| Vitest, jsdom | `TEST_ONLY` | Test runner and DOM test environment. |
| Vite/Rollup/esbuild | `BUILD_ONLY` | Native TypeScript/CSS bundling only; not present in the viewer artifact. |
| System UI/monospace stacks | `PLATFORM_RUNTIME` | No font package or emitted font asset. |
| GitHub Actions checkout/setup-node | `TOOLCHAIN_EXTERNAL` | CI orchestration, not copied into release. |
| Prompt Master, Headroom | `EXPLICIT_EXTERNAL_EXCEPTION` | Separately managed and outside Afyx Graph release. |

### Historical legal evidence

These files are intentionally retained and are not to be rewritten or deleted
in Phase 5F:

- `afyx-graph/THIRD_PARTY_NOTICES.md`
- `afyx-graph/LICENSES/THIRD_PARTY_ENGINE_MIT.txt`
- `afyx-graph/engine/LICENSE`

The first two are copied into current bundles. The Colby Mchenry attribution is
retained pending technical replacement evidence and Phase 5H provenance/legal
review. The repository root `LICENSE` remains the project license. No legal
obligation conclusion is made in this phase.

## Controlled release before-state

Command: `scripts/build-bundle.sh win32-x64` using its default Node version.
The archive was created locally and was not published.

| Measure | Before-state |
| --- | ---: |
| Target | `win32-x64` |
| Archive SHA-256 | `f90524e7df219ea3d60786d70a329cd5a0c2426ba9207ef30cf7379195db5bbe` |
| Compressed bytes | 49,828,770 |
| Files | 1,628 |
| Uncompressed bytes | 229,341,184 |
| Bundled Node | 1 file / 92,279,112 bytes |
| `node_modules` | 194 files / 58,527,055 bytes |
| WASM | 68 files / 122,348,375 bytes |
| Viewer | 46 files / 1,077,326 bytes |
| Optional kernel | absent for this controlled target |
| Historical legal files | 2 |
| Distribution verification | PASS: 2 viewer asset references, 29 copied grammars, 338 engine source maps, 2 legal files |

A sorted per-file manifest was generated with the repository's
`distribution-contract.mjs manifest` command at:

`%TEMP%\afyx-phase5f-before-20261004\artifact-manifest.json`

Manifest SHA-256:
`108fabf29713286d579e9d97ff9e119ceae06beaa85725e080bf666748b0a3c0`
(336,352 bytes). This scratch artifact is evidence only and is not committed.
The committed machine-readable summary is
`docs/evidence/phase5f-before-inventory.json`.

## Replacement decisions and execution order

1. Replace product utility dependencies behind narrow Afyx contracts: CLI and
   prompts, ignore matching, observed glob subset, and surgical JSONC editing.
2. Replace Svelte/XYFlow/fonts with Afyx-owned native browser presentation,
   preserving the existing adapter and wire boundaries.
3. Establish clean-room Afyx fact extraction family by family. Do not translate
   grammar/parser sources; remove old WASM only after semantic gates pass.
4. Remove or independently reimplement the optional kernel only after parser
   correctness and performance evidence is available.
5. Change distribution to a documented host-Node boundary; remove staged Node,
   `node_modules`, grammar WASM, optional kernel, and third-party browser assets.
6. Audit a real after-state artifact and run full supported-platform CI.

## Utility / product runtime checkpoint

Checkpoint date: 2026-10-04. The utility boundary is complete; UI, parser,
kernel, and final distribution/runtime replacement remain pending.

### Usage map and Afyx-owned replacements

| Removed dependency | Previous use | Preserved product contract | Afyx owner | Risk / focused evidence |
| --- | --- | --- | --- | --- |
| `commander` | `src/bin/afyx-graph.ts`, `src/bin/cli-registry.ts` | Fixed command grammar, aliases, positional/variadic arguments, flags, help/version, parse errors, exit behavior | `src/bin/cli-parser.ts` | High; CLI semantic, version, context, node, UI, and color suites |
| `@clack/prompts` | CLI installer flow in `src/installer/index.ts` | Select/multiselect/confirm, cancellation, `--yes`, redirected-input safety | `src/runtime/terminal.ts` | High; terminal contract and installer matrix |
| `fast-string-width`, `fast-wrap-ansi`, `sisteransi` | Transitive prompt presentation | Predictable readable terminal output without decorative framework behavior | Eliminated with the prompt stack | Low; terminal and CLI presentation suites |
| `ignore` | `src/index.ts`, `src/extraction/index.ts` | Ordered ignore rules, negation/re-inclusion, rooted/directory patterns, separators, traversal refusal | `src/runtime/ignore-matcher.ts` | High; matcher corpus, config suites, and OLD/NEW real scope parity |
| `picomatch` | Cargo/workspace path matching | Only the observed `*`, `**`, `?`, class, and normalized-path subset; unsupported syntax is rejected | `src/runtime/path-pattern.ts` | Medium; matcher corpus and framework/workspace suites |
| `jsonc-parser` | provider installers and workspace/package configuration | Comments, trailing commas, surgical nested set/remove, formatting and line-ending preservation, malformed-input refusal | `src/runtime/jsonc.ts` | Very high; JSONC golden corpus and 242-case installer/provider matrix |

No replacement package was added. Direct production dependencies are now
only `tree-sitter-wasms` and `web-tree-sitter`, which belong to the later
parser boundary. The non-dev lock closure, excluding the UI workspace root
record itself, fell from 51 entries to 41. `@clack/core` and
`fast-string-truncated-width` disappeared with their owning runtime.

### Final behavior and scope evidence

- Clean lockfile install: PASS (`npm ci`).
- Focused final candidate: 517 passed, 4 declared skips, 0 failed.
- CLI semantic contract: root and query help digests unchanged; missing option
  values and the `--` terminator are covered.
- JSONC golden corpus: 7/7 PASS.
- Matcher corpus: 14/14 PASS.
- Installer/provider matrix: 242 passed, 3 declared skips.
- OLD/NEW engine-root scope on the same final worktree: 981 files each;
  sorted relative-path SHA-256
  `1f1e836b3a28e4e0ced2d710412a886b5ecf26a429903f4c16ea8f32143ea8c1`;
  no OLD-only or NEW-only paths. This final rerun supersedes the earlier
  provisional 979-file capture.
- TypeScript typecheck, clean production/UI build, six semantic fixtures,
  21-check CLI/MCP smoke, and repository validator: PASS.
- Full high-parallel Windows run: 5,503 passed, 213 skipped, 35 failures in
  13 files. Isolated reruns cleared all timeout/contention cases. Six files
  completed functional assertions and then failed only while deleting Windows
  temporary directories (`EPERM`). `extraction-old-git.test.ts` retains its
  baseline-local Windows separator assertion (`dir_b\\b.ts` versus the
  established normalized `dir_b/b.ts`); the exact OLD checkpoint fails the
  same assertion. No utility product regression remains unexplained.

### Controlled utility artifact

The controlled `win32-x64` bundle was built with Node v24.16.0 and passed the
distribution verifier (2 viewer references, 29 copied grammars, 343 engine
source maps, 2 historical legal files).

| Measure | Before | Utility checkpoint |
| --- | ---: | ---: |
| Archive bytes | 49,828,770 | 49,566,958 |
| Archive SHA-256 | `f90524e7df219ea3d60786d70a329cd5a0c2426ba9207ef30cf7379195db5bbe` | `db56aa351284ecd56645724fe2635bde3d6e3ce1c0a9c2da8cf33083be503efb` |
| Bundle files | 1,628 | 1,560 |
| Uncompressed bytes | 229,341,184 | 228,429,183 |
| `node_modules` files | 194 | 106 |
| `node_modules` bytes | 58,527,055 | 57,543,696 |

The staged production package set is exactly `tree-sitter-wasms` and
`web-tree-sitter`; all removed utility packages and prompt transitives are
absent. Bundled Node, `node_modules`, parser WASM, viewer runtime, and historical
legal files are intentionally still present for later Phase 5F boundaries.

No third-party implementation will be copied or translated, no replacement
dependency will be introduced, and behavior tests will not be weakened.

## UI runtime checkpoint

Checkpoint date: 2026-10-04. The browser presentation boundary is now Afyx-owned;
parser/grammar, native-kernel, and bundled-runtime work remain pending.

### Ownership map and architecture

| Classification | Modules / responsibility |
| --- | --- |
| `PURE_ADAPTER_KEEP` | `ui/src/lib/adapter.ts`, `api.ts`, `wire.ts`, `navigation.ts` |
| `PURE_MODEL_KEEP` | symbol/file/file-code/flow/map/screens/steps/search/entry/dead-code/trail/export models |
| `NATIVE_DOM_REWRITE` | `native/app.ts`, `native/search.ts`, `native/components.ts`, `native/views.ts`, `native/dom.ts` |
| `NATIVE_SVG_REWRITE` | `native/graph.ts`, `native/viewport.ts`; consumes existing deterministic layout output |
| `STYLING_KEEP_OR_ADAPT` | `theme.css` tokens plus native `app.css`; system font stacks |
| `THIRD_PARTY_RUNTIME_REMOVE` | Svelte component/runtime/compiler integration and XYFlow/D3 presentation closure |
| `THIRD_PARTY_ASSET_REMOVE` | Archivo and IBM Plex packages and emitted font files |
| `DEAD_AFTER_REWRITE` | all active `.svelte`, rune-state `.svelte.ts`, and Svelte build configuration |

The browser remains presentation-only: `GraphAdapter` and the typed wire
contract are unchanged data boundaries. Native views use explicit mount/dispose
lifecycles. Hash routing, deep links, search, trail state, live EventSource
updates, keyboard navigation, loading/error/empty states, and all major views
remain available. Flow, Map, Screens, and Steps use bounded native SVG pan/zoom
over the existing Afyx layout models; extraction, traversal, ranking, impact,
indexing, and database semantics remain in the core.

### Dependency and artifact closure

- UI production dependencies and peer dependencies: zero.
- Active `.svelte` / `.svelte.ts` product source: zero.
- Removed packages: Svelte, Svelte compiler/plugin/package/check tooling,
  `@xyflow/svelte`, `@xyflow/system`, their D3 transitives, and both fontsource
  packages.
- Retained build-only tools: TypeScript and Vite/Rollup/esbuild. The generated
  viewer contains one HTML file, one Afyx JavaScript asset, and one Afyx CSS
  asset; it contains no build-tool runtime.
- Viewer before: 46 files / 1,077,326 bytes; 506,225 JS bytes; 100,782 CSS bytes;
  43 font files / 469,752 font bytes.
- Viewer checkpoint: 3 files / 85,615 bytes; 77,003 JS bytes; 8,045 CSS bytes;
  zero font files and zero source maps.
- Controlled `win32-x64` archive: 48,932,591 bytes; SHA-256
  `a422fe665596a1fbfcecef77092401e3440d193b0bed0f6f316c2b821dbd2517`;
  1,517 files / 227,437,426 uncompressed bytes. Distribution verification
  passed with 2 viewer asset references, 29 grammars, 343 engine source maps,
  and 2 historical legal files.
- Viewer byte scan found no Svelte, XYFlow, D3, fontsource, bundled font-name,
  third-party banner, package URL, or `node_modules` signature.

### Validation

- Clean lockfile install: PASS (`npm ci`; the local Node 26 engine-range warning
  is environmental—the controlled bundle uses Node 24.16.0).
- Native/package/UI model/API/security campaign: 687 passed, 4 declared skips.
- Native package-specific tests: 20 passed, including loading/error, routing,
  search, required views, deterministic SVG structure, viewport bounds, and
  cleanup/dispose behavior.
- Clean TypeScript/UI/production build: PASS.
- Semantic baseline: PASS (6 fixtures).
- CLI/MCP smoke: PASS (21 checks).
- Repository static validator: PASS.
- Real-browser automation was not added because none exists in the repository;
  jsdom DOM/SVG tests, live HTTP server/security tests, built-asset fetches, and
  CLI UI serving are the supported smoke evidence.

Historical legal files were not modified. This checkpoint makes no legal
conclusion; it records only that third-party UI runtime/source/assets were not
detected in the shipped viewer.

## Target after-state gates

- production npm runtime dependency tree: zero
- bundled Node and shipped `node_modules`: zero
- tracked/shipped third-party grammar WASM: zero
- third-party parser runtime and vendored grammar source: zero
- shipped third-party browser runtime/assets: zero
- shipped third-party native kernel: zero
- new third-party dependencies: zero
- language semantic contract, core regression, release audit, and cross-platform
  CI: pass
- historical legal evidence: retained for Phase 5H

## Validation ledger

| Boundary | Evidence | Status |
| --- | --- | --- |
| Precondition | branch and `main` at canonical baseline; clean worktree | PASS |
| Inventory | package/lock imports, UI artifact, Cargo/lock, grammar assets, scripts/workflows/legal files | PASS |
| Before-state release | local `win32-x64` build plus distribution verifier and manifest | PASS |
| Utility replacement | Afyx CLI/terminal/matchers/JSONC; clean dependency closure; scope parity; controlled bundle | PASS |
| UI replacement | Native DOM/SVG runtime, zero production UI dependencies, controlled viewer artifact audit | PASS |
| Parser/grammar replacement | Ownership frozen; native scanner plus initial TypeScript/JavaScript, Python, Go, and Java fact routes validated behind the opt-in gate | ACTIVE |
| Kernel closure | Not started | PENDING |
| Runtime/distribution after-state | Not started | PENDING |
| Full regression and CI | Not started | PENDING |

Phase 5F is not complete at this checkpoint.

## Parser / grammar ownership freeze

The parser boundary started from 29 tracked grammar WASM files totaling
68,192,092 bytes and two production packages (`web-tree-sitter` and
`tree-sitter-wasms`). Forty-eight active TypeScript modules reference the old
runtime, its syntax-node model, parser loading, or shared traversal helpers.

| Ownership | Current modules | Migration rule |
| --- | --- | --- |
| `PARSER_RUNTIME_REMOVE` | `grammars.ts`, `web-tree-sitter.d.ts`, parser bootstrap/cache, grammar WASM | Remove after native semantic gates pass. |
| `SYNTAX_COUPLED_REWRITE` | `tree-sitter.ts`, `tree-sitter-types.ts`, `function-ref.ts`, `syntax-tokens.ts`, `cfml-extractor.ts`, language configs, branch guards/policy | Replace traversal mechanics with Afyx-native scanners and fact recognizers; retain semantic policy. |
| `GRAPH_FACT_LOGIC_KEEP` | graph node/edge/reference schemas, resolution, reconciliation, extraction admission | Preserve public graph meaning and ordering. |
| `FORMAT_EXTRACTOR_KEEP` | Liquid, Razor, MyBatis XML, DFM/FMX, YAML/Twig/properties file-level paths | Keep independently owned format parsing; remove only actual old-parser coupling. |
| `ROUTING_KEEP` | extension/content detection, extractor registry, worker/store boundaries | Preserve supported-language and orchestration contracts while simplifying grammar bootstrap. |
| `FRAMEWORK_LOGIC_KEEP` | framework resolvers and SFC source-offset mapping | Preserve framework facts; embedded JS/TS moves to the native recognizer. |
| `TEST_ORACLE_REWRITE` | kernel parity and grammar/bootstrap tests | Compare semantic facts against native output; do not retain the old runtime as a committed oracle. |
| `DEAD_AFTER_NATIVE_PARSER` | grammar loaders/copy checks and add-language AST/WASM diagnostics | Remove only after all language routes are accounted for. |
| `DEFER_KERNEL` | Rust kernel sources, Cargo dependencies, vendored kernel grammars | Remain a later Phase 5F boundary. |

The first native foundation is a dependency-free bounded lexical scanner. It
uses UTF-16 offsets/columns, treats strings and comments as opaque, records
balanced delimiters without constructing a Tree-sitter-compatible AST, and
reports incomplete strings/comments/delimiters without throwing or looping.

### Native semantic convergence checkpoints

- `a904901` converges the initial TypeScript/JavaScript, Python, and Go fact
  routes. The native unit/differential suites pass, and the native-enabled
  extraction campaign has 651/655 passing assertions; the four remaining
  failures are the established Windows temporary-directory cleanup `EPERM`
  class rather than semantic assertions.
- `7f409dc` adds the Java route with package containment, imports, methods,
  fields, anonymous classes, inheritance, instantiation, annotation, and
  static-member references. Java focused contracts pass 12/12 and the
  representative OLD/NEW Java semantic fixture is identical. The subsequent
  full campaign exposed one static-member assertion, which was corrected and
  revalidated directly; the native unit/differential suite passes 10/10.

`AFYX_GRAPH_NATIVE_PARSER=1` remains required. This is an active convergence
checkpoint, not parser-boundary completion: other language families, syntax
tokens, function references, branch guards, bootstrap/package removal, and
grammar-WASM removal remain pending.

### Cross-cutting native convergence after `11a2922`

- `e3e200f` migrates syntax-token classification for TypeScript, TSX,
  JavaScript, JSX, Python, Go, and Java. Embedded SFC JavaScript/TypeScript
  regions reuse the native classifier under the opt-in gate; the public
  highlight payload remains compatible.
- `9dbf892` migrates function-reference candidates for those native routes,
  including scoped `this` references, Java method references, Python
  class-as-value references, and import/same-file ownership filtering.
- `9d0101e` adds an Afyx-owned token/source branch-guard reader for TypeScript,
  TSX, JavaScript, and JSX.
- `c3fe36b3823bbcb1f28ed49f0a9a760cbe0565f7` extends that reader to Python,
  Java, and Go. Python uses bounded token/line/indentation recognition; Java
  and Go reuse the bounded delimiter reader. The established forms are
  preserved: if/else/elif, early exits, conditional/logical expressions,
  match/switch cases, catch/except, Go init conditions and terminal calls,
  plus named function/lambda boundaries. Java switch rules retain the OLD
  oracle's behavior (no case guard) rather than adding new semantics here.
  Call-site arguments, triggers, loops, pending languages, and the fallback
  policy remain on the established route.

The authoritative focused branch-guard suite is now 68/68 PASS (correcting
the earlier 59/59 note; the prior checkpoint actually ran 63 tests). OLD/NEW
differential coverage is 7/7 PASS with no intentional output differences:

| Language | OLD SHA-256 | NEW SHA-256 |
| --- | --- | --- |
| TypeScript / TSX / JavaScript / JSX (each) | `ac44b990fdd504bf44fed0e10f5954b86f0c84aaa8dd0dc848742eb8dc9a3583` | identical |
| Python | `fbd070d81c4a246faa62576f849b07a6cfda1461e513384f1f7b1696edc19282` | identical |
| Java | `6f2330a123d82d36b7a6457440dd769988ba994f6f9e95ec5b7740ef0ad01c2d` | identical |
| Go | `9ad182f55ed0c1bbf04e061fe8f6fe6f28715fa834ff17548906c6fb4154dcf5` | identical |

The combined native cross-cutting gate passes 139/139 and typecheck/build
pass. Native-enabled extraction completes all 651 functional assertions; its
four reported failures remain Windows temporary-directory `fs.rmSync` EPERM
after assertions. CLI/MCP smoke passes 21/21. The semantic gate's graph
structure is unchanged, but native-enabled runs differ from the frozen file
only in two floating search scores; the same build without the native gate
passes all six fixtures, so no search/baseline change was made in this parser
sub-boundary.

The native-complete fact and syntax-token set is TypeScript, TSX, JavaScript,
JSX, Python, Go, and Java. Branch guards are native for all seven routes.
Swift, Kotlin, C#, C, C++, and Objective-C guard profiles remain on the safe
fallback because their fact routes are not native-complete. ArkTS and the
remaining systems, JVM, dynamic, enterprise, and
parser-coupled special-format routes remain pending. Afyx-owned file-level or
special format routes remain unchanged.

The active `web-tree-sitter`/`SyntaxNode` source coupling count is still 34
files (baseline 34). This checkpoint introduces no new coupling, but does not
remove the fallback modules yet. Production dependencies remain
`web-tree-sitter` and `tree-sitter-wasms`; grammar WASM, bootstrap removal,
artifact audit, and the parser PR remain deferred until every real route is
native and validated.

### Rust, Kotlin, and Scala native semantic checkpoint

The parser branch incorporated canonical `main` at
`5349c4a184e539f0ac0752d895ff3262c6326e29` through merge commit
`01fb8153e3bab4dcac0ce6463a8ed3513c9b769c`; the earlier parser checkpoint
`d9039bf784c33bb494fbc24c5eaa72a97b43c61e` remains in its ancestry. Commit
`b321ca7` adds dependency-free Rust, Kotlin, and Scala fact recognition and
extends the native syntax route to all three languages. Kotlin also joins the
native branch-guard route.

The native scanner now treats Rust lifetimes, raw strings, and nested block
comments deterministically; Kotlin backtick identifiers and Kotlin/Scala
triple-quoted strings remain opaque to declaration scanning. The recognizers
preserve the Afyx-required graph surface:

- Rust types, enum variants, traits, associated/impl methods, implementing-type
  ownership, trait relations, use roots, const/static initializers, qualified
  calls, Rocket handler macros, declared return types, and function values.
- Kotlin package/import ownership, classes/interfaces/objects/companions/enums,
  `fun interface`, methods/functions, `expect`/`actual`, field versus shared
  property ownership, initializer/accessor calls, destructuring RHS calls,
  inheritance/type refs, nullable return types, callable refs, and established
  `if`/`when`/catch/early-exit branch guards.
- Scala classes/objects/traits/enums/cases, top-level and owned definitions,
  field versus object/top-level val/var ownership, type aliases and annotation
  refs, extension methods, imports, visibility, calls/function values, and
  declared return types, including bounded Scala 3 indentation bodies.

The native route set is now ten languages: TypeScript, TSX, JavaScript, JSX,
Python, Go, Java, Rust, Kotlin, and Scala. The final affected focused candidate
passed 92/92 cross-cutting tests and 61/61 selected extraction/resolution tests;
the function-reference campaign passed 20/20. Typecheck, clean production/UI
build, and the 21-check CLI/MCP smoke passed. The native extraction campaign
reached all 655 functional assertions: 647 tests completed normally, seven
completed their assertions and then hit the established Windows temporary-dir
cleanup `EPERM`, and the remaining Kotlin backtick-identifier assertion was
corrected and passed on its focused rerun.

The normal six-fixture semantic baseline passes. The native-gated structural
graph remains unchanged; its only frozen-baseline differences are still the
same two TypeScript floating search scores recorded above, so the limitation is
`SAME`, not expanded.

No package, lockfile, grammar WASM, old language adapter, generated parser
artifact, or legal record is removed by this checkpoint. The safe fallback is
still needed for languages not yet migrated and when the opt-in gate is off.
Active `web-tree-sitter`/`SyntaxNode` source coupling remains 34 files and the
two production parser dependencies remain `web-tree-sitter` and
`tree-sitter-wasms`. Removing those dependencies, their grammar assets, and the
bootstrap belongs to final parser closure after every parser-coupled route is
native.

Remaining parser work includes ArkTS; C, C++, Objective-C, C#, and Solidity;
PHP, Ruby, Swift, Dart, Lua/Luau, R, and Nix; Pascal, CFML/CFScript/CFQuery,
COBOL, VB.NET, and Erlang; Terraform/OpenTofu parser-backed semantics; and
parser-coupled SFC/template/special-format internals. Established branch guards
still pending native migration are Swift, C#, C, C++, and Objective-C. Kernel,
bootstrap/dependency/WASM removal, after-state artifact audit, and the parser
major PR remain later Phase 5F work.

### C-family native semantic and branch-guard checkpoint

Commit `ef66aff` adds an Afyx-owned, dependency-free semantic fact route for
C, C++, Objective-C, and C# behind `AFYX_GRAPH_NATIVE_PARSER=1`. Successful
gated extraction for these languages now enters `c-family-facts.ts` directly;
it does not invoke their Tree-sitter language adapters. Normal ungated routing
is intentionally unchanged until the full parser migration is complete.

The bounded product contracts covered by this route are:

- C functions and calls, aggregate and typedef ownership, includes, type
  dependencies, function-pointer aliases, and function-value references.
- C++ namespaces, aggregates and enums, inheritance, owned and out-of-line
  methods, constructors/destructors, required template/type relationships,
  qualified/chained/operator calls, stack/heap construction, and member
  references.
- Objective-C protocols, interfaces/implementations, properties, instance and
  class methods, imports, inheritance/protocol conformance, message sends, and
  nested factory-message calls. Interface declarations and implementation
  bodies converge on one owned method fact.
- C# namespaces, classes/structs/interfaces/records/enums, properties, fields,
  methods, inheritance/interface relationships, nullable/generic type
  dependencies, qualified/factory calls, and callable references.

The shared scanner now handles bounded C++ raw strings and C# verbatim and
interpolated string forms, including deterministic incomplete-string
reporting. Native syntax classification includes all four languages. Their
established `if`/`else`, switch/case, loop, catch, logical-condition, and
early-exit branch guards now use the Afyx-native token view, with C-family
function/method boundaries and Objective-C message syntax kept distinct.

Validation for this checkpoint passed 155/155 shared native, syntax,
function-reference, and branch-guard tests in both gated and normal modes. The
focused scanner/C-family contracts passed 15/15. The selected C-family
extraction/resolution campaign completed 153 semantic assertions; its two
reported failures occurred only in post-assertion Windows temporary-directory
`fs.rmSync` cleanup with the established `EPERM` behavior. Typecheck, clean
production/UI build, the normal six-fixture semantic baseline, and all 21
CLI/MCP smoke checks passed.

The native semantic route set is now fourteen languages: TypeScript, TSX,
JavaScript, JSX, Python, Go, Java, Rust, Kotlin, Scala, C, C++, Objective-C,
and C#. Active `web-tree-sitter`/`SyntaxNode` source coupling remains 34 files
(baseline 34): the superseded C-family adapters cannot yet be deleted because
ungated mode and pending parser-coupled paths still use the shared fallback
registry. No package, lockfile, grammar WASM, legal record, or runtime
dependency was removed. `web-tree-sitter` and `tree-sitter-wasms` remain
required until all remaining production routes converge.

Remaining parser work includes ArkTS and Solidity; PHP, Ruby, Swift, Dart,
Lua/Luau, R, and Nix; Pascal, CFML/CFScript/CFQuery, COBOL, VB.NET, and Erlang;
Terraform/OpenTofu parser-backed semantics; and parser-coupled
SFC/template/special-format internals. The established Swift branch guards
remain pending. Kernel, bootstrap/dependency/WASM removal, after-state artifact
audit, and the parser major PR remain later Phase 5F boundaries.

### Swift native semantic and branch-guard checkpoint

Commit `54eae35` adds the fifteenth feature-gated native semantic route. With
`AFYX_GRAPH_NATIVE_PARSER=1`, Swift now enters the Afyx-owned
`swift-facts.ts` recognizer directly and no longer executes the Swift
Tree-sitter semantic adapter. Ungated extraction remains on the established
fallback until the complete parser migration is ready for cutover.

The bounded Swift contract includes module imports; classes, structs,
protocols, enums, actors, extensions, type aliases and associated types;
owned functions, methods, initializers, properties, fields and enum cases;
inheritance/protocol conformance and extension-target references; generic,
optional, return and property-wrapper/metatype dependencies; calls, qualified
and factory-chain calls; and scoped callable values. Computed-property calls
remain owned by the property, while locals remain outside the definition
graph.

The scanner now consumes Swift raw and multiline strings and nested block
comments as bounded opaque regions, reporting incomplete strings without
hanging or throwing. Swift syntax highlighting uses the native classifier.
Native branch guards preserve `guard` continuation versus exit-arm polarity,
`if`/`else`, ternary, switch/case/default, catch, logical and early-exit
semantics. Function, assigned-closure, parameterized-closure and trailing-
closure boundaries prevent conditions from leaking between execution scopes.

The focused native Swift suite passes 6/6 and the expanded scanner suite
passes 7/7. The frozen Swift semantic/guard oracle passes 21/21 under the
native gate; the broader Swift extraction/resolution selection passes 19/19.
Shared native, syntax, function-reference and branch-guard regression coverage
passes 164/164 in native mode and 164/164 in normal mode. Typecheck, clean
production/UI build, the normal six-fixture semantic baseline and all 21
CLI/MCP smoke checks pass. No semantic failure or cleanup-only Windows
`EPERM` occurred in this boundary.

The native semantic set is now fifteen languages: TypeScript, TSX,
JavaScript, JSX, Python, Go, Java, Rust, Kotlin, Scala, C, C++, Objective-C,
C#, and Swift. The previously identified established native branch-guard
backlog is now closed. Active `web-tree-sitter`/`SyntaxNode` source coupling
remains 34 files (34 → 34), because normal ungated mode and the remaining
parser-backed languages still share the fallback registry and adapters. No
Swift grammar asset, package, lockfile entry, runtime dependency, legal record,
or attribution file is removed at this checkpoint.

Remaining parser boundaries include ArkTS and Solidity; PHP, Ruby, Dart,
Lua/Luau, R, and Nix; Pascal, CFML/CFScript/CFQuery, COBOL, VB.NET, and Erlang;
Terraform/OpenTofu semantics; and parser-coupled SFC/template/special-format
internals. `web-tree-sitter`, `tree-sitter-wasms`, grammar WASM and parser
bootstrap removal remain blocked until those production routes converge. The
next dependency-safe language boundary is ArkTS, reusing the proven native
TypeScript-family scanner/fact surface without starting that work here.

### ArkTS native semantic checkpoint

Commit `3a73108` adds ArkTS as the sixteenth feature-gated native semantic
route. With `AFYX_GRAPH_NATIVE_PARSER=1`, `.ets` files now enter the shared
Afyx-native TypeScript-family fact recognizer directly; the ArkTS Tree-sitter
adapter and grammar are not invoked for successful native fact extraction.
Ungated extraction remains unchanged.

ArkTS reuses the native TypeScript-family scanner, modules/imports, classes,
interfaces, enums, type aliases, members, inheritance/implementation, type
references, constructors, calls, instantiations, callable references, and
ownership. The bounded ArkTS specialization adds decorated `struct`
components and members, decorator metadata, ArkUI dot-prefixed attribute
calls, and `.onXxx(this.handler)` bindings. Native syntax classification reuses
the TypeScript vocabulary with the ArkTS `struct` keyword, and ArkTS now uses
the existing native TypeScript-family branch-guard implementation.

The focused native ArkTS suite passes 4/4. The established ArkTS extraction
contract passes 17/17 in native mode, and its normal-mode extraction plus
syntax counterpart passes 18/18. Seven end-to-end ArkTS resolution cases
completed their semantic assertions before the established Windows
temporary-directory cleanup `EPERM`. Shared fact, syntax, function-reference,
and branch-guard regression coverage passes 107/107. Typecheck, clean
production/UI build, the six-fixture semantic baseline, all 21 CLI/MCP smoke
checks, and `git diff --check` pass. The broad native extraction campaign has
642/655 normal completions, seven post-assertion cleanup `EPERM` results, and
six pre-existing C/CUDA native semantic gaps outside this boundary.

The native semantic set is now sixteen languages: TypeScript, TSX,
JavaScript, JSX, Python, Go, Java, Rust, Kotlin, Scala, C, C++, Objective-C,
C#, Swift, and ArkTS. Active `web-tree-sitter`/`SyntaxNode` source coupling
remains 34 files (34 → 34). The ArkTS adapter and
`tree-sitter-arkts.wasm` remain required by ungated/default execution,
packaging, and the shared fallback bootstrap; no parser package, lockfile,
grammar asset, legal record, or attribution file is removed.

Remaining parser boundaries include Solidity; PHP, Ruby, Dart, Lua/Luau, R,
and Nix; Pascal, CFML/CFScript/CFQuery, COBOL, VB.NET, and Erlang;
Terraform/OpenTofu semantics; and parser-coupled SFC/template/special-format
internals. `web-tree-sitter`, `tree-sitter-wasms`, grammar WASM, and parser
bootstrap removal remain blocked. The next dependency-safe language boundary
is Solidity; it is not started by this checkpoint.

### Solidity native semantic checkpoint

Commit `c029b49` adds Solidity as the seventeenth feature-gated native semantic
route. With `AFYX_GRAPH_NATIVE_PARSER=1`, `.sol` files now enter the bounded
Afyx-owned `solidity-facts.ts` recognizer directly. Successful native semantic
extraction does not load the Solidity Tree-sitter adapter, grammar, or WASM;
ungated/default extraction remains unchanged.

The native contract covers imports and aliases; contracts, interfaces,
libraries, structs, enums, value-type aliases, functions, constructors,
modifiers, fallback/receive functions, state variables, constants, events and
custom errors; containment; Solidity `is` inheritance; user-defined, mapping,
array, parameter and return-type references; `using` library references;
internal/member calls; base-constructor and modifier invocations; event emits,
custom-error reverts; and `new` instantiations. Events and custom errors retain
the established field-shaped definitions, while their uses remain call facts.
Inline assembly is delimiter-bounded but intentionally not parsed as Yul.

The existing native scanner required no change. Native syntax classification
adds Solidity keywords and elementary-width types. No Solidity-specific branch
machinery was added: the required semantic ownership is bounded by declaration
and brace scopes, and the established Solidity contract has no parser-backed
branch-guard surface.

The focused native Solidity suite passes 4/4. The established Solidity
extraction contract passes 12/12 under the native gate and 12/12 in normal
mode. Shared scanner/fact/syntax and already-native language coverage passes
50/50. Typecheck, clean production/UI build, the six-fixture semantic baseline,
all 21 CLI/MCP smoke checks, and `git diff --check` pass. No semantic failure
or Windows cleanup `EPERM` occurred in this boundary. There is no separately
maintained Solidity resolution fixture; the focused suite validates the exact
unresolved inheritance, type, modifier, event/error, call, and instantiation
facts consumed by the shared resolver.

The native semantic set is now seventeen languages: TypeScript, TSX,
JavaScript, JSX, Python, Go, Java, Rust, Kotlin, Scala, C, C++, Objective-C,
C#, Swift, ArkTS, and Solidity. Active `web-tree-sitter`/`SyntaxNode` source
coupling remains 34 files (34 → 34). The existing Solidity adapter and
`tree-sitter-solidity.wasm` remain required production fallback assets for
ungated/default execution, packaging, and shared parser bootstrap. No parser
package, lockfile, grammar asset, legal record, or attribution file is removed.

Remaining parser boundaries include PHP, Ruby, Dart, Lua/Luau, R, and Nix;
Pascal, CFML/CFScript/CFQuery, COBOL, VB.NET, and Erlang; Terraform/OpenTofu
semantics; and parser-coupled SFC/template/special-format internals.
`web-tree-sitter`, `tree-sitter-wasms`, grammar WASM, and parser bootstrap
removal remain blocked. The next dependency-safe task is a separate audit of
the remaining dynamic-language group; no such language is started here.

### PHP, Ruby, Lua/Luau, and R native semantic checkpoint

Commit `3662726` adds five feature-gated native semantic routes, increasing
the native set from seventeen to twenty-two languages. With
`AFYX_GRAPH_NATIVE_PARSER=1`, PHP, Ruby, Lua, Luau, and R now enter bounded
Afyx-owned fact recognizers directly; successful semantic extraction and
syntax classification do not invoke their Tree-sitter adapters or grammar
WASM. Ungated/default extraction remains on the established fallback.

The implementation keeps language-specific contracts separate behind a small
shared fact/result builder. PHP covers namespaces and `use` imports, class-like
containers, members, inheritance/composition, typed references, calls,
construction, includes, closures/arrow functions, and established HOF callable
forms. Ruby covers nested modules/classes, methods and singleton methods,
inheritance/mixins, require paths, receiver/bare calls, Rails callback symbols,
and assignment-bound lambda scope. Lua and Luau share one scanner/fact core for
functions, table/module methods, `require`, calls, callable values, and
function-valued assignment ownership; Luau adds exported type aliases, typed
signatures, return types, and type references. R covers assignment-bound and
nested functions, file variables/constants, package/source dependencies,
namespaced/member calls, callable values, and the established S4/R5/R6/ggproto
class and method idioms.

Scanner changes are deliberately narrow: Lua line/long-bracket comments and
long strings, plus the R assignment/namespace operators. Native syntax
vocabularies now cover all five routes. No separate branch-guard subsystem was
added because these languages do not have an established parser-backed guard
API in the current product contract; callable and closure ownership is instead
bounded directly by function, brace, `end`, and assignment scopes.

Validation passed the new focused family suite 13/13, the selected established
extraction/resolution contracts 45/45 in native mode and 45/45 in normal mode,
the complete function-reference campaign 20/20, and the selected shared-native
campaign 61/61. Typecheck, clean production and UI builds, the six-fixture
semantic baseline, all 21 CLI/MCP smoke checks, and `git diff --check` pass.
The optional native-kernel parity suites were unavailable and skipped 23/23.
The one broad 655-test native extraction campaign recorded 642 normal passes,
six previously documented C/CUDA native semantic gaps outside this boundary,
and seven post-assertion Windows cleanup `EPERM` results. Its initial Lua
doc-comment mismatch was corrected; the focused rerun passed the Lua assertions
and then stopped at the existing C doc-comment gap.

Active `web-tree-sitter`/`SyntaxNode` source coupling remains 34 files
(34 → 34). The PHP, Ruby, Lua, Luau, and R adapters and grammar assets remain
required production fallback and release assets while ungated mode is
supported; the clean build still stages all 29 grammar WASM files. No parser
package, lockfile, grammar asset, bootstrap code, legal record, or attribution
file is removed. `web-tree-sitter` and `tree-sitter-wasms` therefore remain
production dependencies.

The native semantic set is now TypeScript, TSX, JavaScript, JSX, Python, Go,
Java, Rust, Kotlin, Scala, C, C++, Objective-C, C#, Swift, ArkTS, Solidity,
PHP, Ruby, Lua, Luau, and R. Remaining parser boundaries include Dart and Nix;
Pascal, CFML/CFScript/CFQuery, COBOL, VB.NET, and Erlang; Terraform/OpenTofu;
and parser-coupled SFC/template/special-format internals. Parser bootstrap,
dependency, grammar-WASM, and fallback removal remain blocked. The recommended
next Phase 5F boundary is a separate evidence-first Dart/Nix contract audit;
that work is not started by this checkpoint.

### Dart and Nix native semantic checkpoint

Commit `26d4e71` adds Dart and Nix as the twenty-third and twenty-fourth
feature-gated native semantic routes. The languages remain one valid delivery
checkpoint because both reuse the bounded scanner, delimiter map, dynamic fact
schema, and syntax classifier, while their high-level fact recognizers remain
separate. No Dart analyzer, Nix evaluator, generic AST, or new parser
architecture was introduced. With `AFYX_GRAPH_NATIVE_PARSER=1`, successful
Dart and Nix semantic extraction and syntax classification no longer invoke
their Tree-sitter language adapters or grammar WASM. Ungated/default behavior
continues to use the established fallback.

The Dart recognizer preserves imports, exports, and parts; class-shaped class,
mixin, and extension definitions; enums, aliases, functions, methods, named
constructors, fields, and shared constants; containment and visibility;
extends/implements/mixin and declared-type references; construction, calls,
factory/constructor chains, callable values, and same-file constant reads.
Constant reads remain direct graph edges and fail closed for a locally shadowed
name. Function and arrow bodies provide bounded call ownership; there was no
separate established Dart branch-guard contract to migrate.

The Nix recognizer is deliberately lexical. It preserves attribute and
`let` bindings, curried functions and attribute-set arguments, exported result
sets, `inherit`, static relative `import`/`builtins.import`, module/import lists,
`callPackage` dependencies, function application, attribute selections, and
same-file callable values. Dynamic imports and interpolation text do not become
static file dependencies. It performs no evaluation, derivation execution,
nixpkgs resolution, or module-system interpretation.

Scanner changes are limited to Dart raw/triple-quoted strings and Nix indented
strings. Native syntax vocabularies and routing now cover both languages; Nix
hash comments and lambda colons are classified without borrowing type syntax.
The dynamic fact builder gained only the metadata fields already present in the
public node contract and a direct-target reference path needed to retain
shadow-safe value-read edges.

Validation passed the focused Dart/Nix suite 6/6, selected native-gated
extraction/resolution/value-reference contracts 37/37, scanner/fact/syntax/
differential/function-reference regression 41/41, and the selected normal-mode
counterpart 51/51. Default UI highlighting passed 33/33. The full native-gated
UI matrix passed 32/33 and retained one pre-existing Ruby definition-token gap
(`class Store` is still an identifier), while all Dart/Nix syntax assertions
passed. Typecheck,
the clean production/UI build, UI artifact verification, the six-fixture
semantic baseline, all 21 CLI/MCP smoke checks, and `git diff --check` pass. A
first semantic-baseline process ended with a transient Windows `0xC0000005`
before assertions; the isolated rerun passed all six fixtures.

The one broad 655-test native extraction campaign recorded 642 assertion
passes, the same six pre-existing C/CUDA semantic gaps, and seven post-assertion
Windows cleanup failures classified `CLEANUP_ONLY_EPERM`. No Dart or Nix
regression was present. These C/CUDA gaps remain explicit closure work rather
than accepted behavior.

Active `web-tree-sitter`/`SyntaxNode` source coupling remains 34 files
(34 → 34). The existing Dart and Nix adapters remain required by normal-mode
fallback, and `tree-sitter-dart.wasm` (984,666 bytes) plus
`tree-sitter-nix.wasm` (80,876 bytes) remain production/release assets. The
clean build still stages all 29 grammar WASM files. No parser package,
lockfile, bootstrap path, grammar asset, attribution, or legal record is
removed, so `web-tree-sitter` and `tree-sitter-wasms` remain production
dependencies.

The native semantic set is now TypeScript, TSX, JavaScript, JSX, Python, Go,
Java, Rust, Kotlin, Scala, C, C++, Objective-C, C#, Swift, ArkTS, Solidity,
PHP, Ruby, Lua, Luau, R, Dart, and Nix. Remaining parser-backed groups are
Pascal, CFML/CFScript/CFQuery, COBOL, VB.NET, and Erlang;
Terraform/OpenTofu; and parser-coupled SFC/template/special-format internals.
Parser bootstrap, default fallback, dependency, and grammar-WASM elimination
remain blocked. Before expanding to another language family, the recommended
next Phase 5F boundary is an evidence-first closure of the six known C/CUDA
native semantic gaps; that work is not started here.

### Native residual contract closure: C/CUDA and Ruby

Commit `ccdca86` closes the seven residuals recorded by the Dart/Nix
checkpoint without adding a language route or changing the normal fallback.
All seven fixtures describe product facts or token classes, not historical
Tree-sitter topology.

The six C/CUDA deltas and their corrections are:

1. A C block comment immediately before a function was not copied into the
   native node's `docstring`. The C-family declaration start also included the
   comment token, leaving no preceding token to inspect. This was a
   `C_FAMILY_NATIVE_REGRESSION`; native declarations now start after leading
   comments and normalize the adjacent documentation token.
2. `__launch_bounds__(...)` was selected as the function name instead of the
   following kernel declarator. This was a `CUDA_EXTENSION_OF_C_CONTRACT`;
   declaration attributes and their balanced argument ranges are excluded from
   callable candidates.
3. A macro-defined kernel indexed the macro parameter (`kernelName`) rather
   than the invocation's concrete first argument (`fwd_kernel`). This was a
   `CUDA_EXTENSION_OF_C_CONTRACT`; continued preprocessor directives are kept
   outside declaration discovery and a structurally proven CUDA definition
   macro names its body from that first invocation argument.
4. A launch through a local function-pointer alias produced no concrete kernel
   calls. This was a `CUDA_EXTENSION_OF_C_CONTRACT`; bounded alias assignments
   now map a launch to every distinct assigned kernel target.
5. A templated CUDA launch in an extension-less header produced no call fact.
   This was a `CUDA_EXTENSION_OF_C_CONTRACT`; the native C++ recognizer now
   captures the bounded `callee<...><<<...>>>(...)` surface directly, so the
   behavior is content-based rather than filename-specific.
6. GNU `__attribute__((section(...)))` was indexed first as `__attribute__`
   and then as `section`, swallowing the actual `RawAttr` function. This was a
   `C_FAMILY_NATIVE_REGRESSION`; attribute call/range candidates are excluded,
   leaving the following real declarator authoritative.

The Ruby UI gap came from incomplete editor input. `class Store` without an
`end` produced no native class fact because container recognition required a
matched terminator; consequently syntax classification had no definition
offset and rendered `Store` as an identifier. The bounded native recognizer now
uses the final available token as the provisional container end. Complete Ruby
ownership remains unchanged, while the native-gated UI matrix moves from
32/33 to 33/33.

Focused validation passed all seven former residuals. The selected C/CUDA
fixture group passed 11/11, native C-family 9/9, dynamic-language coverage
including Ruby and Lua/Luau 13/13, native syntax 8/8, function references
20/20, and the C function-pointer synthesizer 18/18. Two optional real-kernel
sweep tests remained unavailable and skipped. Representative completed-route
coverage for Rust/Kotlin/Scala and Dart/Nix passed 12/12. The equivalent
normal-mode C/CUDA selection passed 11/11 and default UI highlighting passed
33/33.

The repeated broad native extraction campaign recorded 648 normal completions
and seven post-assertion Windows teardown failures, all classified
`CLEANUP_ONLY_EPERM`; no semantic assertion residual remains. The full
native-gated UI matrix passed 33/33. Typecheck, clean production/UI build,
viewer and 29-grammar artifact validation, the six-fixture semantic baseline,
all 21 CLI/MCP smoke checks, and `git diff --check` pass.

Active `web-tree-sitter`/`SyntaxNode` source coupling remains 34 files
(34 → 34). `web-tree-sitter`, `tree-sitter-wasms`, all 29 grammar WASM files,
parser adapters, bootstrap paths, lockfiles, attribution, and legal records are
retained because ungated fallback and remaining parser-backed routes still
require them.

The native semantic language count remains 24. Known legitimate native
C/CUDA and Ruby token residuals are now zero. Parser-backed production groups
still include Pascal, CFML/CFScript/CFQuery, COBOL, VB.NET, Erlang, and
Terraform/OpenTofu, plus parser-coupled SFC/template/special-format internals.
Default fallback and parser bootstrap elimination remain blocked. The next
recommended Phase 5F boundary is a separate evidence-first inventory of the
remaining enterprise routes and dependency-safe slice selection; no such
migration is started by this checkpoint.

### Remaining-route inventory and Pascal native checkpoint

Starting checkpoint `4798089` retained eight named parser-backed production
routes plus parser-coupled special formats. The inventory below records the
actual product contract rather than language-spec completeness. Complexity,
reuse, and coupling describe the pre-change route.

| Route | Runtime/parser path and Afyx contract | Convergence evidence | Classification |
| --- | --- | --- | --- |
| Pascal/Delphi source | Extension registration selected the Pascal WASM and generic `TreeSitterExtractor`, augmented by Pascal-only type/uses/constant/procedure/body walkers and function/value-reference capture. Required facts are unit/program identity, uses dependencies, classes/records/interfaces/enums/aliases, members and visibility, inheritance, calls (including paren-less and typed factory chains), callable values, shared constants, and DFM code-behind resolution. | Complexity MEDIUM; native reuse HIGH; coupling LOCAL; scanner delta SMALL; resolution impact MEDIUM; special-format risk LOW for source and explicitly separated for DFM/FMX; independence MODERATE. Existing coverage: 29 extraction assertions plus function/value-reference, resolution, and DFM pairing gates. | `READY_FOR_NATIVE_REPLACEMENT`; selected and completed here. |
| CFML tags | `CfmlExtractor` loads the CFML grammar, walks tag nodes, and delegates nested script/query bodies to two more parsers. Required facts include components, tag functions/arguments/properties, includes, inheritance/implements, nested calls and typed receiver inference. | Complexity HIGH; reuse MEDIUM; coupling DEEP across three grammars; scanner delta MATERIAL; resolution HIGH; special-format risk HIGH; independence HARD. Twenty-two extraction tests plus dedicated inheritance and receiver suites cover the retained behavior. | `SPECIAL_FORMAT_BOUNDARY`; defer to one dedicated CFML-family design. |
| CFScript | Standalone `.cfs` and bare-script `.cfc/.cfm` files use `TreeSitterExtractor('cfscript')`; tag-based files also delegate `<cfscript>` regions to it. Required facts include anonymous components, functions/methods, properties/variables, imports/includes, construction, calls, inheritance, and typed arguments. | Complexity HIGH in the combined route; reuse MEDIUM; coupling SHARED with `CfmlExtractor`; scanner delta MATERIAL; resolution HIGH; special-format risk HIGH; independence HARD when separated from tag CFML. | `READY_WITH_SHARED_FAMILY`, specifically the CFML/CFScript/CFQuery family; not safe as an isolated checkpoint. |
| CFQuery | The grammar is not a file-extension route; `CfmlExtractor` delegates `<cfquery>` SQL bodies and retains CFML expressions/calls embedded there. | Complexity LOW alone but boundary coupling DEEP; reuse LOW; scanner delta MATERIAL for mixed SQL/CFML; resolution MEDIUM; special-format risk HIGH; independence HARD. | `SPECIAL_FORMAT_BOUNDARY`; close only with CFML family. |
| COBOL | Patched fixed-format COBOL WASM plus a large custom `visitNode` reconstructs flat PROGRAM-ID, section/paragraph extents, PERFORM/THRU, GO TO, literal CALL, CICS LINK/XCTL, SQL INCLUDE, COPY, and hierarchical data/condition entries. Copybook resolution and CICS synthesis consume the facts. | Complexity HIGH; reuse LOW; coupling DEEP; scanner delta MATERIAL (fixed/free format and copybooks); resolution HIGH; special-format risk MEDIUM; independence HARD. Twelve focused extraction assertions exist, but the custom semantic surface and resolver bridges require a standalone campaign. | `REQUIRES_SPECIALIZED_NATIVE_DELTA`. |
| VB.NET | VB.NET WASM and the generic extractor plus language hook cover namespaces, classes/modules/interfaces/structures/enums/delegates, members/events, Imports, Inherits/Implements, calls/index-shaped invocations, construction, and types. XML literals, multi-line LINQ, abstract members, nullable declarators, and case-insensitive syntax are required editor-safe behavior. | Complexity MEDIUM-HIGH; reuse MEDIUM; coupling SHARED; scanner delta MATERIAL; resolution MEDIUM; special-format risk MEDIUM (XML literals); independence MODERATE/HARD. Thirteen focused extraction assertions establish the current contract. | `REQUIRES_SPECIALIZED_NATIVE_DELTA`; it does not share a safe lexical/semantic boundary with Pascal. |
| Erlang | Erlang WASM and custom hooks merge multi-clause functions by name/arity, own modules/records/types/callbacks/specs/macros/includes, and classify local/remote calls, `fun` refs, dynamic MFA, and record uses. Arity matching and behaviour dispatch add dedicated resolver/synthesizer paths. | Complexity HIGH; reuse LOW; coupling DEEP; scanner delta MATERIAL; resolution HIGH; special-format risk MEDIUM for `.app`/`.app.src`; independence HARD. Thirty-four extraction assertions plus arity and behaviour suites cover the current contract. | `REQUIRES_SPECIALIZED_NATIVE_DELTA`; requires a form/arity-specific recognizer, not a generic parser layer. |
| Terraform/OpenTofu | Terraform/HCL WASM and a large custom hook interpret labelled blocks and traversals into resources, data sources, modules, variables, outputs, locals, providers and moved/import relationships. The Terraform framework resolver supplies module-boundary, remote-state and provider-alias behavior. | Complexity HIGH; reuse MEDIUM; coupling DEEP; scanner delta MATERIAL (heredocs/templates/traversals); resolution HIGH; special-format risk HIGH; independence HARD. Twenty-six extraction assertions plus framework integration cover the retained contract. | `REQUIRES_SPECIALIZED_NATIVE_DELTA`; standalone domain checkpoint required. |

The selected slice was Pascal source semantics and syntax classification. It
removed a complete named route, reused the existing scanner, delimiter map,
dynamic fact builder, resolver contracts, and syntax classifier, and needed no
new parser abstraction. Its six-file implementation commit is `8717546`.
VB.NET was not bundled merely because both languages are case-insensitive and
use end-delimited blocks: VB XML literals, LINQ clauses, invocation/index
ambiguity, and statement grammar form a materially different risk boundary.
CFML, COBOL, Erlang, and Terraform each retain dedicated domain semantics that
would make a combined slice neither cohesive nor independently reversible.

The Afyx-native Pascal recognizer consumes scanner tokens directly and emits
the public fact schema. It covers unit/program/library fallback identity;
dotted uses imports; class, record, interface, enum, alias, member and constant
facts; visibility, static methods, signatures and return types; extends and
implements; implementation-only functions; ordinary, paren-less and typed
factory-chain calls; callable values; and shadow-safe same-file constant reads.
The scanner delta is limited to brace and paren-star comments, doubled-quote
strings, and `:=`/`<>`. Incomplete comments produce a bounded warning while
preserving prefix facts. Native syntax classification uses the same facts for
definition offsets plus Pascal keyword/builtin vocabularies.

`AFYX_GRAPH_NATIVE_PARSER=1` routes `.pas`, `.dpr`, `.dpk`, and `.lpr` source
to this recognizer without requesting `getParser()`. `.dfm` and `.fmx` remain
on their existing parser-free `DfmExtractor`; the explicit route exclusion is
covered by the broad native campaign. Ungated/default Pascal remains on the
Tree-sitter fallback.

#### Special-format inventory

| Format/route | Current dependency and semantic purpose | Future closure |
| --- | --- | --- |
| Svelte | Regex locates `<script>` regions; semantic extraction delegates JS/TS to `TreeSitterExtractor`. Native-gated viewer syntax already tokenizes those regions natively. | Route semantic delegation through the established native JS/TS fact entry point while preserving source offsets and Svelte template facts. |
| Vue | Same direct JS/TS parser delegation pattern for script blocks, plus Vue template/store facts and router synthesis. Native-gated syntax regions are already native. | Dedicated offset/ownership adapter around native JS/TS facts; retain Vue template semantics. |
| Astro | Frontmatter and script regions delegate directly to the TypeScript parser while markup facts remain custom. Native-gated syntax regions are already native. | Dedicated region-offset adapter using native TypeScript facts. |
| Razor/Blazor | Custom markup extraction delegates `@code`/C# regions directly to `TreeSitterExtractor('csharp')` for component logic and types. | Dedicated C# region adapter preserving markup-to-code ownership and `_Imports.razor` behavior. |
| CFML/CFScript/CFQuery | Three parser grammars cooperate inside one mixed tag/script/query semantic route. | A dedicated family-native design; do not emulate the three ASTs. |
| DFM/FMX | `DfmExtractor` is already parser-free and emits component hierarchy/event refs; sibling Pascal code-behind is now native-gated. | No parser replacement needed; keep the format boundary and pairing regression. |
| Liquid | Custom lexical/template extractor; no `web-tree-sitter`/`SyntaxNode` dependency. | No parser replacement needed. |
| MyBatis XML | Custom XML mapper extractor; no Tree-sitter dependency. | No parser replacement needed. |
| YAML, Twig, properties | File-level-only routes at this stage; no symbol parser is invoked. Framework resolvers may add bounded file facts. | No grammar migration until a new product contract requires symbol semantics. |

#### Validation and independence state

- Focused Pascal native contract and differential: 51/51 PASS (including the
  new 4/4 direct seam suite); normal-mode Pascal counterpart: 47/47 PASS.
- Shared scanner/fact/syntax/differential/function-reference/branch-guard/UI
  campaign: 137/137 PASS; native UI remains 33/33 PASS.
- The broad native extraction campaign completed 648 semantic assertions and
  recorded the same seven post-assertion Windows temp-directory cleanup
  failures, classified `CLEANUP_ONLY_EPERM`; semantic residuals are zero.
- TypeScript typecheck, clean production/UI build, viewer and 29-grammar
  artifact validation, six-fixture semantic baseline, all 21 CLI/MCP smoke
  checks, and `git diff --check` pass.

Native semantic languages increase from 24 to 25. Named parser-backed routes
decrease from eight to seven: CFML, CFScript, CFQuery, COBOL, VB.NET, Erlang,
and Terraform/OpenTofu remain. Active `web-tree-sitter`/`SyntaxNode` source
coupling remains 34 files (34 → 34), and staged grammar WASM remains 29
(29 → 29). The Pascal adapter and `tree-sitter-pascal.wasm` remain active
default production fallback and release assets; they are neither obsolete nor
test-only. Default fallback and parser bootstrap remain ACTIVE, so parser
packages, lockfiles, grammar assets, legal records, and attribution stay in
place.

The next dependency-safe Phase 5F boundary is VB.NET native semantic and syntax
convergence. It has a bounded single-language route and meaningful native
scanner/fact reuse, while avoiding the deeper multi-grammar/domain resolver
boundaries of CFML, COBOL, Erlang, and Terraform. That boundary is not started
by this checkpoint.

### VB.NET native semantic and syntax checkpoint

Starting checkpoint `7e02e85c096b0b19d696b5304d9d024c0ef255d2` retained
VB.NET as one of seven named parser-backed routes. Commit `a95b50a` adds a
feature-gated, dependency-free VB.NET recognizer and native syntax route. With
`AFYX_GRAPH_NATIVE_PARSER=1`, `.vb` semantic extraction and highlighting use
scanner tokens and emit Afyx facts directly; a structural seam test proves
that supported extraction does not request `getParser()`. Ungated/default mode
still uses the established VB.NET Tree-sitter adapter.

The required product contract is deliberately smaller than the language
specification. It includes namespaces; classes, modules, structures,
interfaces, enums and delegates; methods, constructors, properties, fields,
constants-as-established-members and events; Imports; Inherits/Implements;
user return/header types; calls, index-shaped invocation candidates and
construction; ownership; mixed-case keywords; and bounded incomplete editor
input. Operators, Roslyn binding, full default-property inference, LINQ query
evaluation, XML DOM semantics, and a complete Visual Basic grammar are outside
the observed contract. The existing resolver performs exact symbol-name
lookup, so this slice does not globally case-fold identifiers. It preserves
original identifier spelling while all VB keyword/modifier/type comparisons
inside the native boundary are case-insensitive; the controlled OLD/NEW
differential includes a differently-cased call reference and remains
identical.

XML literals are opaque scanner tokens because Afyx requires the surrounding
VB routine and sibling facts, not XML internals. A complete root or self-closing
literal is consumed as one bounded region; malformed editor input is limited
to the current line and produces the standard native incomplete-source
warning. LINQ remains ordinary routine-owned token flow, preserving calls such
as `big.Sum()` without representing query-clause topology. Parenthesized
`foo(...)` remains a call candidate, matching the previous adapter's deliberate
invocation/index ambiguity policy; unresolved index-shaped candidates simply
do not become graph edges. Multiline lambdas are range-balanced so calls stay
owned by the enclosing named routine, but lambdas do not become new public
nodes. No public parser-backed VB.NET branch-guard contract exists, so no guard
or control-flow subsystem was added.

The scanner delta is limited to apostrophe and statement-position `REM`
comments, doubled-quote/interpolated strings, bracketed identifiers, and the
bounded XML policy. Syntax classification uses the native definition facts,
case-folded VB keyword/builtin vocabularies, and `As` type context. Tests cover
the prior 13 extraction assertions, direct OLD/NEW semantic parity, native
seam isolation, XML/comment/string boundaries, mixed-case syntax, multiline
lambda ownership, and incomplete input.

Validation results:

- Focused scanner/syntax/VB suite: 21/21 PASS, including the new 6/6 native
  contract/seam tests.
- Existing VB.NET extraction contract under native mode: 13/13 PASS; the same
  default/ungated counterpart remains 13/13 PASS.
- Shared fact/differential/function-reference/native UI campaign: 59/59 PASS;
  the native UI matrix remains 33/33 PASS.
- Remaining completed-route native suites: 66/67 PASS. The sole failure is the
  pre-existing Go branch-boundary fixture (`outer` guard leakage); the four
  guard source/test files are byte-identical to the starting checkpoint and
  the scanner delta executes only when `vbnetSyntax` is enabled. It is not a
  VB.NET or scanner regression and is not widened into this boundary.
- Broad native extraction: 648 semantic assertions PASS, zero semantic
  residuals, plus seven post-assertion Windows temp-directory failures
  classified `CLEANUP_ONLY_EPERM`.
- Typecheck, clean production build, UI build, viewer/29-grammar artifact
  verification, six-fixture semantic baseline, all 21 CLI/MCP smoke checks,
  and `git diff --check` PASS.

Native semantic languages increase from 25 to 26 and known native semantic
gaps remain zero. Named parser-backed routes decrease from seven to six:
CFML, CFScript, CFQuery, COBOL, Erlang, and Terraform/OpenTofu. Active
`web-tree-sitter`/`SyntaxNode` source coupling remains 34 files (34 → 34), and
staged grammar WASM remains 29 (29 → 29). The 6,477,499-byte
`tree-sitter-vbnet.wasm`, VB adapter, parser bootstrap, `web-tree-sitter`, and
`tree-sitter-wasms` remain active default-production/release dependencies, not
obsolete assets; no package, lockfile, attribution, or legal record is removed.

Remaining special-format coupling is unchanged: Svelte, Vue, and Astro retain
script-region delegation; Razor/Blazor retains C# region delegation; and the
CFML/CFScript/CFQuery family retains its mixed three-grammar orchestration.
The next dependency-safe Phase 5F boundary is Erlang native semantic and syntax
convergence: it is a single named route with a contained form/arity contract,
whereas COBOL, Terraform/OpenTofu, and the CFML family have deeper domain or
mixed-format resolver boundaries. That boundary is not started here.

### Go native branch-boundary residual closure

The VB.NET checkpoint exposed one older completed-route residual in the shared
native guard campaign: a Go call inside `callback := func(){ ... }` incorrectly
inherited the enclosing function's preceding `if outer { return }` guard. The
failure reproduced independently and deterministically 3/3. Its primary
classification is `FUNCTION_BOUNDARY_OWNERSHIP_BUG`.

The native scanner has always emitted Go's short assignment as the compound
token `:=`. `functionBoundary()` recognized an assigned Go function literal
only when scanning backward found `=` or the legacy split pair `:` plus `=`.
It therefore failed to mark the literal body as a new execution boundary and
allowed the outer early-return guard to reach the inner call. Commit `92acfa9`
adds the missing compound-token recognition. It does not change scanners,
fact extraction, resolver behavior, or any non-Go branch rule.

The original isolation fixture now passes, and a durable regression proves
both halves of the contract: `outer` is absent while a legitimate `if inner`
inside the literal remains attached to `run()`. Focused regression is 2/2;
the complete native/legacy branch-guard selection is 70/70; and the campaign
that previously recorded 66/67 now passes all 67 original assertions plus the
new regression (68/68). Go extraction passed 8/8 and shared native
differential/fact/syntax/function-reference/resolution coverage passed 47/47.

The broad native extraction campaign again completed 648 semantic assertions
with zero residuals and seven post-assertion Windows temp-directory failures
classified `CLEANUP_ONLY_EPERM`. Native UI remains 33/33. Typecheck, clean
production/UI build, viewer and 29-grammar artifact verification, the
six-fixture semantic baseline, all 21 CLI/MCP smoke checks, and
`git diff --check` pass.

This correction changes no third-party boundary: native semantic languages
remain 26, named parser-backed routes remain six, known native semantic gaps
move from one to zero, active `web-tree-sitter`/`SyntaxNode` coupling remains
34 files, staged grammar WASM remains 29, and default fallback plus parser
bootstrap remain active. The next boundary remains Erlang native semantic and
syntax convergence; it is not started here.

### Erlang native semantic and syntax checkpoint

Starting checkpoint `2fba81c9f35bb18ee925e43d18cbbba2af06d46d`
retained Erlang as one of six named parser-backed routes. Commit `934e47c`
adds a feature-gated, dependency-free Erlang recognizer and native syntax
route. With `AFYX_GRAPH_NATIVE_PARSER=1`, `.erl`, `.hrl`, `.escript`, `.app`,
and `.app.src` semantic extraction uses scanner tokens and emits Afyx facts
directly; a structural seam test proves that the route does not request
`getParser()`. Ungated/default mode continues to use the Erlang grammar and
adapter.

The retained contract is form- and arity-based rather than a compiler model.
`-module` owns declarations, while functions retain a bare display name and
use `module::name/arity` identity. Clauses in one period-terminated form merge
into one logical function; same-name functions with different arities remain
distinct. Export state is arity-specific and `export_all` remains supported.
The bounded attribute surface covers imports/includes, behaviours, records and
fields, type/opaque aliases, preceding matching specs, callbacks as
non-symbol type declarations, and macros as constant/link boundaries. Macro
replacement bodies own their calls, use sites link to the macro, predefined
macros remain silent, and no preprocessor expansion is attempted.

Local calls use `name/arity`, static remote calls use
`module::name/arity`, and variable module/function dispatch stays silent.
`fun name/arity`, `fun module:name/arity`, record uses, statically evident
spawn/apply-family MFA arguments, and established `gen_server` registered-name
handler conventions are preserved. Anonymous and named-fun bodies remain
owned by the enclosing public function; no anonymous public node is invented.
Application resource terms retain callback-module and dependency references.
No public Erlang branch-guard contract exists, so case/receive/if/try clauses
receive no invented control-flow facts.

The scanner delta is limited to percent comments, quoted atoms, ordinary
strings, character literals, Erlang number/form termination, and binary-aware
arity counting. Existing delimiter handling covers tuples, lists, records and
maps. Incomplete strings or delimiters remain bounded and preserve prefix
facts. Native syntax adds Erlang attribute/control/operator vocabulary and
uses the semantic facts to identify function definitions. This intentionally
improves the function name from the grammar route's plain `ident` class to
`def`; other controlled syntax classes remain equal.

Validation results:

- New native contract/differential/seam/syntax/incomplete/boundary suite: 7/7
  PASS. The direct semantic and syntax proofs observe no parser request.
- Established Erlang extraction under native mode: 34/34 PASS; the same
  default/ungated contract remains 34/34 PASS.
- Erlang arity resolution and behaviour synthesis: 8/8 PASS, including binary
  literal arity handling. Total focused Erlang evidence is 49/49 PASS.
- Shared completed-route fact/syntax/differential suites: 66/66 PASS; scanner
  and branch-boundary regressions: 18/18 PASS.
- Broad native extraction completed 648 semantic assertions with zero semantic
  residuals. The same seven Windows temp-directory cleanup failures remain
  classified `CLEANUP_ONLY_EPERM`.
- Native UI highlighting remains 33/33 PASS. TypeScript typecheck, clean
  production/UI builds, viewer/29-grammar artifact verification, the standard
  six-fixture semantic baseline, all 21 CLI/MCP smoke checks, and
  `git diff --check` pass.

Native semantic languages increase from 26 to 27 and known native semantic
gaps remain zero. Named parser-backed routes decrease from six to five: COBOL,
Terraform/OpenTofu, CFML, CFScript, and CFQuery. Active
`web-tree-sitter`/`SyntaxNode` source coupling remains 34 files (34 → 34), and
staged grammar WASM remains 29 (29 → 29). The Erlang adapter and grammar asset
remain active default-production fallback and packaged release dependencies;
they are not obsolete, build-only, or test-only. Default fallback and parser
bootstrap remain ACTIVE, so no parser package, WASM, lockfile, attribution, or
legal record is removed.

Remaining special-format coupling is unchanged: Svelte, Vue, and Astro retain
script-region delegation; Razor/Blazor retains C# region delegation; and the
CFML/CFScript/CFQuery family remains a single mixed-format three-grammar
boundary. The next dependency-safe Phase 5F boundary is Terraform/OpenTofu
native semantic and syntax convergence: it is one cohesive named route with
meaningful scanner/fact reuse, while COBOL requires its fixed-format and
copybook campaign and the CFML family requires a combined mixed-format design.
That boundary is not started here.

### Terraform / OpenTofu native semantic and syntax checkpoint

Starting checkpoint `cb368c28268e2d7deb2babe2f51be0dacd186e6d`
retained Terraform/OpenTofu as one of five named parser-backed routes. Commit
`f16381d` adds a feature-gated, dependency-free HCL recognizer and native
syntax route. With `AFYX_GRAPH_NATIVE_PARSER=1`, the existing `.tf`, `.tfvars`,
and `.tofu` registrations emit Afyx facts directly without requesting
`getParser()`. OpenTofu has no separate adapter or semantic delta in the
repository, so it deliberately shares this native core. Ungated/default mode
continues to use the Terraform grammar and adapter.

The retained structural contract is block/address based. Managed resources
remain `class` nodes identified as `TYPE.NAME`; data sources remain `class`
nodes identified as `data.TYPE.NAME`; modules use `module.NAME`; variables use
`var.NAME`; outputs use `output.NAME`; provider configurations use
`provider.NAME[.ALIAS]`; and every direct locals attribute is a `constant`
identified as `local.NAME`. The `terraform` settings block and
`required_providers` internals intentionally declare no graph symbols, matching
the previous route. Generic nested provider/resource schemas are not modeled.

Static traversal recognition preserves `var.X`, `local.X`, `module.M`,
`module.M:output.X`, `module.M:remote-output.X`, `data.TYPE.NAME`, and managed
resource `TYPE.NAME` references. Index and splat syntax may follow a statically
known base without changing its identity; built-in roots (`each`, `count`,
`self`, `path`, `terraform`) remain silent. Runtime values, computed target
names, and arbitrary provider attributes are never evaluated.

Local module sources beginning `./` or `../` retain the scoped
`module.M:file` import plus scoped child-input references. Registry, git,
variable, conditional, and interpolated module sources do not create a guessed
file edge. Module output and Cloud Posse/Atmos remote-output candidates remain
resolver-owned and directory/uniqueness scoped. `.tfvars` assignments continue
to reference root `var.NAME` declarations without becoming symbols.

Provider aliases remain distinct definitions. Static `provider = aws.east`
and module `providers` map values reference provider configurations, while
keys and dynamic selections stay silent. `depends_on` remains an ordinary
explicit traversal dependency. `moved`, `import`, `removed`, and check/assert
addresses remain file-anchored references. `data
"terraform_remote_state"` is a normal data source; no backend or state is
opened. The established framework resolver continues to provide local module,
provider-ancestor, and remote-output bridges unchanged.

Terraform function names do not produce callable graph facts in the existing
contract; statically visible traversals inside their arguments still do. The
native implementation preserves that boundary and does not interpret built-in
functions. Quoted strings are opaque except for bounded `${...}` / `%{...}`
template regions. Heredoc and indented-heredoc bodies are likewise opaque
except for those regions, so Terraform-looking plain text cannot mint facts.
Incomplete strings, heredocs, and delimiters produce bounded diagnostics while
retaining prefix declarations and references.

The shared scanner delta is limited to HCL heredocs and hyphenated identifiers;
existing hash, slash-line, and block comments plus quoted-string handling are
reused. Native syntax preserves the controlled parser-backed surface for block
heads, labels, attributes, literals, comments, and expression keywords. The
semantic extractor owns no `SyntaxNode`, parser adapter, grammar, provider
runtime, module downloader, evaluator, or state access.

Validation results:

- New native semantic differential, `.tf`/`.tfvars`/`.tofu` seam, syntax
  differential, heredoc/interpolation, incomplete-buffer, dynamic-boundary,
  and call-boundary suite: 8/8 PASS. Both semantic and syntax proofs observe
  no parser request.
- Established Terraform extraction under native mode: 25/25 PASS; the same
  default/ungated contract remains 25/25 PASS.
- Existing Terraform module/provider/remote-state resolution integration: 2/2
  PASS. Total focused Terraform/OpenTofu evidence is 35/35 PASS.
- Shared scanner and completed native-route suites: 70/70 PASS; representative
  Go scanner/extraction coverage: 2/2 PASS.
- Broad native extraction completed 648 semantic assertions with zero semantic
  residuals. The same seven Windows temp-directory teardown failures remain
  classified `CLEANUP_ONLY_EPERM`.
- Native UI highlighting remains 33/33 PASS. TypeScript typecheck, clean
  production/UI builds, viewer/29-grammar artifact verification, the standard
  six-fixture semantic baseline, all 21 CLI/MCP smoke checks, and
  `git diff --check` pass.

Native semantic languages increase from 27 to 28 and known native semantic
gaps remain zero. Named parser-backed routes decrease from five to four:
COBOL, CFML, CFScript, and CFQuery. Active
`web-tree-sitter`/`SyntaxNode` source coupling remains 34 files (34 → 34), and
staged grammar WASM remains 29 (29 → 29). The 92,484-byte Terraform grammar
asset remains an active default-production fallback and packaged release
dependency; it is not obsolete, build-only, or test-only. Default fallback and
parser bootstrap remain ACTIVE, so no parser package, WASM, lockfile,
attribution, or legal record is removed.

Remaining special-format coupling is unchanged: Svelte, Vue, and Astro retain
script-region delegation; Razor/Blazor retains C# region delegation; and the
CFML/CFScript/CFQuery family remains a combined mixed-format three-grammar
boundary. The next dependency-safe Phase 5F boundary is COBOL native semantic
and syntax convergence: it is one cohesive named route, whereas the remaining
CFML family must be designed and validated together. That boundary is not
started here, and Phase 5F is not marked complete.

### COBOL native semantic and syntax checkpoint

Starting checkpoint `6c94cfe0019116abff7a8ee9c2c2fc6b6040e57d`
retained COBOL as one of four named parser-backed routes. The COBOL closure
adds a feature-gated, dependency-free recognizer and native syntax route. With
`AFYX_GRAPH_NATIVE_PARSER=1`, the existing `.cbl`, `.cob`, `.cobol`, and `.cpy`
registrations emit Afyx facts directly without requesting `getParser()`.
Ungated/default execution continues to use the patched COBOL grammar and its
adapter.

The native source view is line-oriented and offset-safe. Fixed-format input
keeps columns 1-6 as the sequence area, recognizes the column-7 comment and
continuation indicators, limits source text to the established code area, and
supports `*>` inline comments. Free-format input is recognized from the same
decisive division, `PROGRAM-ID`, and level-number markers as the established
route. It is scanned at its original columns instead of being shifted through
the old seven-space parser shim. Strings, doubled quotes, periods, numbers,
hyphenated identifiers, fixed continuations, comments, and incomplete buffers
are handled locally while preserving original UTF-16 offsets and source
spelling.

Only repository-evidenced structure is modeled. `PROGRAM-ID` remains a
`module`; divisions are structural boundaries rather than graph noise;
PROCEDURE DIVISION sections and paragraphs remain `function` nodes, with
paragraphs owned by their current section. Static `PERFORM` and
`PERFORM ... THRU/THROUGH` targets, static `GO TO`, and quoted-literal `CALL`
targets remain `calls` references. A data-name `CALL` stays conservative and
does not guess a runtime target. Inline `PERFORM` control forms are not
simulated.

DATA DIVISION and data-copybook level entries retain the established
hierarchy: top-level `01`, `66`, and `77` entries are variables, nested entries
are fields, and level `88` condition names are constants owned by the open
data item. `PIC`, `USAGE`, `OCCURS`, and `REDEFINES` remain in the bounded
signature where present; the previous adapter emitted no alias or memory
overlap relationship, so the native route invents none. MOVE, ADD, SUBTRACT,
and COMPUTE write targets retain the established `references` facts, excluding
runtime special registers. No byte layout or general COBOL dataflow is
calculated.

`COPY` remains an import node plus static copybook-name dependency; resolution
continues through the existing case-insensitive basename resolver. There is no
COPY expansion, `REPLACING` evaluation, external library lookup, or missing
file guess. `EXEC SQL` is opaque except for the established static `INCLUDE`
copybook dependency. `EXEC CICS LINK/XCTL PROGRAM` retains literal targets and
same-file literal VALUE dereferencing; `RETURN/START TRANSID` retains literal
or same-file VALUE-backed `cics-transid:` calls. Unknown dynamic values stay
silent. SQL parsing, CICS runtime semantics, JCL, compiler evaluation, and
external dataset/storage behavior remain outside this checkpoint.

Keyword recognition is COBOL-local and case-insensitive; emitted names keep
their source spelling and exact offsets. Native syntax consumes the same
COBOL lexical view and classifies program, section, paragraph, and data-item
definitions plus verbs, strings, numbers, comments, COPY, and EXEC vocabulary.
The previous grammar syntax walk exposed only a sparse token subset; native
mode retains its identifier/string classes while intentionally adding bounded
keyword and definition coverage. Both semantic and syntax seam tests prove
that successful native-gated COBOL execution requests no parser.

Validation results:

- New native semantic differential, semantic/syntax seam, fixed/free source,
  continuation, dynamic-call boundary, syntax, REDEFINES-signature, and
  incomplete-buffer suite: 7/7 PASS.
- Established COBOL extraction remains 12/12 PASS in default/parser-backed
  mode and 12/12 PASS in native-gated mode. Focused COBOL evidence is 31/31.
- Shared native syntax and differential regressions are 12/12 PASS. The
  combined focused semantic/syntax/UI campaign is 52/52 PASS.
- Broad native extraction completed 648 semantic assertions with zero
  semantic residuals. The same seven Windows temp-directory teardown failures
  remain classified `CLEANUP_ONLY_EPERM`, not semantic failures.
- Native UI highlighting remains 33/33 PASS. TypeScript typecheck, clean
  production and UI builds, viewer/29-grammar artifact verification, the
  standard six-fixture semantic baseline, all 21 CLI/MCP smoke checks, and
  `git diff --check` pass.

Native semantic languages increase from 28 to 29 and known native semantic
gaps remain zero. Named parser-backed routes decrease from four to three:
CFML, CFScript, and CFQuery. Active `web-tree-sitter`/`SyntaxNode` source
coupling remains 34 files (34 → 34), and staged grammar WASM remains 29
(29 → 29). The COBOL grammar remains an active default-production fallback,
is loaded by the parser bootstrap when the default route is selected, and is
copied into production/release artifacts. It is not build-only, test-only,
obsolete, or historical/legal-only. No parser package, grammar, lockfile,
adapter, attribution, or legal record is removed while fallback is active.

Remaining special-format coupling is unchanged: Svelte, Vue, and Astro retain
script-region delegation, and Razor/Blazor retains C# region delegation. The
next dependency-safe Phase 5F boundary is the combined CFML / CFScript /
CFQuery mixed-format native convergence campaign. It must be designed and
validated as one family. That boundary is not started here, and Phase 5F is
not marked complete.

### CFML / CFScript / CFQuery native convergence checkpoint

Starting checkpoint `1a7be7cd47fa8a5e20b15f9e5b2ecdc56b175877`
retained the final three named parser-backed routes as one mixed-format
family. The native-gated route now uses one Afyx-owned orchestrator in
`native/cfml-facts.ts`: a bounded CFML tag-region recognizer owns embedded
CFScript and CFQuery regions, all facts retain absolute UTF-16 source
coordinates, and no Tree-sitter node or grammar API crosses the seam.
Ungated/default execution continues to use `CfmlExtractor` and the existing
CFML, CFScript, and CFQuery grammars unchanged.

The native CFML contract preserves file/component identity, explicit or
filename-derived component names, tag functions, access/return metadata,
extends/implements references, containment, unquoted attributes, BOM routing,
and bounded incomplete tags. `cfargument` and `cfproperty` source remains
available to the established receiver inferrer; no new graph nodes are
invented where the parser-backed adapter emitted none. Static tag-only
include/invocation facts likewise remain absent because they were not part of
the established adapter contract.

The CFScript recognizer preserves anonymous component/interface identity,
methods and nested functions, visibility, static imports/includes,
construction references, local/member calls, and the receiver spellings used
by CFML type inference (`svc.save`, `variables.svc.save`). Static literals are
recorded; runtime values, scopes, component lookup, and expression evaluation
remain unresolved. Script declared at component scope produces methods;
script nested in a tag function remains owned by that function, and nested
script functions retain function ownership.

CFQuery remains a bounded embedded region, not a SQL product. It creates no
query, datasource, or query-parameter semantic node because the previous
adapter created none. Only calls inside `#...#` interpolation become graph
references, owned by the enclosing tag function/component. Native syntax
classifies bounded SQL vocabulary, literals, identifiers, and interpolated CF
expressions without executing SQL or resolving schemas. `cfqueryparam` is
retained as tag/source syntax only.

Direct seam evidence covers native-gated CFML and CFScript semantic routes,
embedded CFQuery semantics, and separate CFML/CFScript/CFQuery syntax entry
points: none requests `getParser()`. Three representative OLD/NEW cells
(bare CFC, standalone CFS, mixed tag/script/query) are semantically identical.
The durable family suite is 5/5 PASS; existing default/parser-backed CFML is
22/22 PASS and native-gated CFML is 22/22 PASS. Receiver and inheritance
resolution is 18/18 PASS. The established native syntax regression is 8/8
PASS. The broad native campaign records 648 semantic assertions PASS and the
same seven Windows temp-directory teardown failures, all classified
`CLEANUP_ONLY_EPERM`; semantic residuals remain zero.

Native UI highlighting is 33/33 PASS. TypeScript typecheck, clean production
and UI builds, viewer/29-grammar artifact verification, the six-fixture
semantic baseline, all 21 CLI/MCP smoke checks, and `git diff --check` pass.

Native semantic languages increase from 29 to 31 under the established
registered-file-language convention (CFML and CFScript; CFQuery is embedded).
Known native semantic gaps remain zero. Named parser-backed language routes
decrease from three to zero. Active `web-tree-sitter`/`SyntaxNode` source
coupling remains 34 files (34 → 34), and staged grammar WASM remains 29
(29 → 29). All three CFML-family grammars remain active default-production
fallbacks, loaded by the parser bootstrap and copied into release artifacts;
none is build-only, test-only, obsolete, or historical/legal-only. No parser,
grammar, package, lockfile, adapter, attribution, or legal asset is removed.

Remaining special-format coupling is now Svelte/Vue/Astro script-region
delegation, Razor/Blazor C# region delegation, and the global default
fallback/bootstrap/runtime/grammar reachability. The next dependency-safe
Phase 5F boundary is Svelte/Vue/Astro script-region delegation convergence.
It is not started here, and Phase 5F is not marked complete.

### Svelte / Vue / Astro script-region native convergence checkpoint

Starting checkpoint `52e6151b1439c6ed9305a2a4db354f04f89a59da`
retained three parser-coupled special-format semantic paths. Svelte and Vue
located script blocks with their existing bounded tag scans, selected
JavaScript by default and TypeScript for the established `lang="ts"` /
`lang="typescript"` forms, then instantiated `TreeSitterExtractor`. Astro
used its existing frontmatter and script discovery and delegated both regions
as TypeScript. All three already owned template calls/components themselves;
native-gated script syntax already used JS/TS native tokenization.

The new private `embedded-script` seam preserves that container architecture.
Each extractor discovers its own regions and language, the seam selects the
established native JS/TS fact extractor only when
`AFYX_GRAPH_NATIVE_PARSER=1`, and one coordinate mapper restores absolute
container locations and outer-file language ownership. Ungated execution
still selects `TreeSitterExtractor`, preserving the default fallback. The
bounded compatibility completion retains otherwise-unseen calls inside Vue
Options API object methods without changing the global JS fact contract.

Line offsets are restored for nodes, references, edges, and diagnostics.
Native facts beginning on the first region-local line additionally receive
the opening tag's UTF-16 column offset; later lines retain their original
columns. This fixes the old same-line column loss and is classified
`NATIVE_CORRECTION`; default-mode coordinates remain unchanged. Every region
is extracted independently, so facts remain owned by their region-local
declarations or file node and do not leak between normal/module/setup blocks.
Container nodes and their existing containment edges remain authoritative.

Svelte preserves instance/module discovery, rune filtering, template calls,
and component usages without attempting compiler semantics. Vue preserves
normal and setup blocks, combined-block behavior, template component facts,
and Options API call coverage without compiler transformation. Astro preserves
closed frontmatter and script blocks as TypeScript plus its template facts;
an unclosed frontmatter fence remains non-semantic as before. In native mode,
an unclosed `<script>` keeps bounded prefix facts and is excluded from template
double extraction. Multiple closed or incomplete regions remain independently
bounded. Outer Svelte/Vue/Astro markup discovery stays parser-free.

The syntax-region scan uses the same established native JS/TS token route and
now recognizes a bounded unclosed script region under the native gate. A
direct seam test exercises semantic extraction and syntax for all three
formats while spying on `getParser()`; no parser request occurs. Therefore
native semantic and syntax parser reachability for Svelte, Vue, and Astro is
`TreeSitterExtractor/getParser → none`. Their JavaScript and TypeScript
grammars remain reachable only through ungated/default semantic and syntax
fallback, shared parser bootstrap, packaging, and tests.

Validation results:

- New native special-format differential, absolute-offset, multi-region,
  incomplete-input, language-selection, and no-parser seam suite: 10/10 PASS.
- Existing Vue/Astro extraction: 22/22 PASS in default mode and 22/22 PASS in
  native mode. SvelteKit/Vue router and targeted Svelte/Astro/Vue resolution:
  36/36 PASS.
- Direct JS/TS native fact, syntax, differential, branch-guard, and reference
  regressions: 37/37 PASS.
- Broad native extraction completed 648 semantic assertions with zero
  semantic residuals. Seven Windows temporary-directory teardown failures are
  classified `CLEANUP_ONLY_EPERM`.
- Native UI highlighting remains 33/33 PASS. TypeScript typecheck, clean
  production/UI builds, viewer and 29-grammar artifact verification, the
  six-fixture semantic baseline, all 21 CLI/MCP smoke checks, and
  `git diff --check` pass.

Native semantic languages remain 31, known native semantic gaps remain zero,
and named parser-backed language routes remain zero. Special-format semantic
parser routes decrease from three to zero. Active
`web-tree-sitter`/`SyntaxNode` source coupling remains 34 files (34 → 34), and
staged grammar WASM remains 29 (29 → 29). Default fallback and parser bootstrap
remain ACTIVE; no parser package, grammar, lockfile, attribution, or legal
asset is removed.

The remaining Phase 5F surfaces are Razor/Blazor C# region delegation and the
global default fallback/bootstrap/runtime/grammar reachability. The single
next dependency-safe boundary is Razor / Blazor C# region delegation. It is
not started here, and Phase 5F is not marked complete.

### Razor / Blazor C# region native convergence checkpoint

Starting checkpoint `ec461f75878f7af002db55437073c5ca3af7d85e`
retained the final parser-coupled special-format semantic path. Both `.razor`
and `.cshtml` were routed to `RazorExtractor`. The container already discovered
`@code`, `@functions`, and `@{ ... }` blocks with bounded brace matching, then
wrapped every body in a synthetic C# class and delegated it to
`TreeSitterExtractor('csharp')`. Only external dependency references were kept
and reassigned to the single Razor component node; C# member nodes were never
part of the established Razor graph contract. Razor syntax had no region route
and therefore produced no classified C# spans.

The native-gated route now uses a small Razor-owned region recognizer shared by
semantic and syntax entry points. It recognizes only the three established C#
block forms, skips Razor comments, HTML comments, quoted tag attributes, and
escaped `@@` transitions, and handles C# strings/comments while balancing
braces. Closed blocks remain independent; an unclosed final block is bounded
at end of source so valid prefix references and syntax remain available. No
inline `@Foo`, `@Foo.Bar()`, `@(expression)`, Razor control-flow compiler
semantics, generated classes, dependency-injection runtime, or rendering
behavior is introduced.

Under `AFYX_GRAPH_NATIVE_PARSER=1`, each discovered body is passed directly to
the established native C# fact extractor. The Razor facade retains only its
dependency references, maps them to the component owner, restores absolute
one-based lines, and adds the region's UTF-16 column only on the first local
line. Multiple blocks share the established component owner without leaking
local C# nodes. Constructor type dependencies remain `references`, matching
the old Razor contract. Calls in an implicit `@{ ... }` block are now retained;
the synthetic class previously made those statements invalid, so this bounded
difference is classified `NATIVE_CORRECTION`.

Container-owned behavior is unchanged. `@model` and `@inherits` produce type
references, including bounded generic type names; `@inject` produces a service
type reference; `@typeof` produces a type reference; and PascalCase Blazor
component tags plus generic component type arguments remain references.
`@using`, `@implements`, `@namespace`, `@typeparam`, and `@page` remain outside
the direct extractor's fact output; existing resolver handling such as folder
`_Imports.razor` remains unchanged. `.cshtml` continues to exclude component
tag inference.

Native Razor syntax now exposes only the discovered C# bodies to the existing
native C# classifier and translates its byte offsets back to the container.
Direct spies over representative `.razor` and `.cshtml` semantic and syntax
calls observe zero `getParser()` requests. Default/ungated semantics retain the
synthetic-class Tree-sitter route, and default Razor syntax remains unchanged.

Validation results:

- New native Razor/Blazor differential, seam, offset, ownership, multiple-
  region, directive, escape/comment, incomplete-input, and syntax suite: 6/6
  PASS.
- Established Razor/Blazor integration: 4/4 PASS in default mode and 4/4 PASS
  in native mode.
- Direct C# fact, syntax, branch-guard, differential, and reference regressions:
  44/44 PASS. Svelte/Vue/Astro and CFML special-format regressions: 15/15 PASS.
- Broad native extraction completed 648 semantic assertions with zero semantic
  residuals. Seven Windows temporary-directory teardown failures remain
  `CLEANUP_ONLY_EPERM`.
- Native UI highlighting remains 33/33 PASS. TypeScript typecheck, clean
  production/UI builds, viewer and 29-grammar artifact verification, the
  six-fixture semantic baseline, all 21 CLI/MCP smoke checks, and
  `git diff --check` pass.

Known native semantic gaps remain zero and named parser-backed language routes
remain zero. Parser-coupled special-format semantic routes decrease from one
to zero. Static and direct-seam audit finds no native-mode semantic path that
can instantiate `TreeSitterExtractor` or request a grammar. All grammar-backed
native syntax routes, including embedded Svelte/Vue/Astro and Razor C# regions,
also classify without a parser. The generic syntax fallback entry point remains
reachable for grammarless file-level/custom formats; it can call grammar
loading/`getParser()` but returns unclassified because those formats have no
grammar, so no Tree-sitter parse occurs.

Active `web-tree-sitter`/`SyntaxNode` source coupling remains 34 files
(34 → 34), and staged grammar WASM remains 29 (29 → 29). The C# grammar is not
reachable from native Razor semantic or syntax execution, but remains an active
default-production fallback, bootstrap input, packaged release asset, and test
dependency. Default fallback and parser bootstrap remain ACTIVE. Parser
adapters, packages, WASM, lockfiles, attribution, and legal assets are retained.

CFML/CFScript/CFQuery, Svelte/Vue/Astro, and Razor/Blazor native semantic
convergence are now closed. The only remaining Phase 5F surface is the global
default fallback/bootstrap/runtime/grammar reachability boundary. The next
boundary is **Global Default Fallback & Parser Reachability Closure Audit**;
it is not started here, and Phase 5F is not marked complete.

## Global Parser Reachability Closure Audit

Baseline: `144cae1c5c2542e2aa839cd460af569575a8dfd5` on
`afyx/native-phase5f-parser-grammar`. This audit changes documentation only. It
does not remove the default fallback, parser bootstrap, grammar assets,
dependencies, tests, development tools, or legal/attribution records.

### Current invariants

The established native invariant remains:

| Metric | Value |
| --- | ---: |
| Native semantic parser reachability | 0 |
| Native active syntax parse reachability | 0 |
| Named parser-backed language routes | 0 |
| Parser-coupled special-format semantic routes | 0 |
| Known semantic gaps | 0 |
| Native UI checks | 33/33 PASS |

A minimal reconfirmation covered the last special-format seams: native Razor
6/6, native special-format 10/10, and native CFML 5/5 (21/21 total). The
established broad native result remains 648 semantic assertions with zero
residuals; its seven Windows failures are temporary-directory teardown-only
`EPERM` results. No production source changed, so the broad campaign and builds
were not repeated for this audit.

### Reachability matrix

| Surface | Native mode | Default mode | Primary classification |
| --- | --- | --- | --- |
| Semantic extraction | Native extractors; no parser | Parser-backed fallback remains selected | `DEFAULT_FALLBACK_REACHABLE` |
| Active syntax classification | Native tokenizers; no parser | Tree-walk fallback remains selectable | `DEFAULT_FALLBACK_REACHABLE` |
| Grammarless syntax lookup | May initialize and look up, but cannot parse without a grammar | Same | `DEAD_OR_OBSOLETE` candidate |
| Async engine/index lifecycle | Initializes runtime and loads needed grammars even when native | Same, then parses through fallback | `BOOTSTRAP_REACHABLE` |
| Parse-worker pool | Runs native/kernel extraction too; grammar protocol remains active | Also runs parser fallback | Native pool plus fallback-only protocol |
| UI browser bundle | No parser | No parser | Native/parser-free |
| UI Node highlighting | Native for grammar-backed formats | Fallback remains selectable | `DEFAULT_FALLBACK_REACHABLE` |
| Tests | Native assertions plus parser OLD oracles and dependency checks | Parser-backed assertions | `TEST_ONLY` secondary roots |
| Add-language scripts | Direct parser/grammar imports | Direct parser/grammar imports | `DEV_TOOL_ONLY` |
| Build and release | Copies all tracked WASM and bundles production dependencies | Same | `BUILD_REACHABLE` / `PACKAGING_REACHABLE` |
| Notices and licenses | Retained | Retained | `LEGAL_METADATA_ONLY` |

No route is `NATIVE_SEMANTIC_REACHABLE` or
`NATIVE_SYNTAX_REACHABLE` through Tree-sitter. Parser lookup without a grammar
is recorded separately from active parser execution.

### Default fallback map and feature flag

Native dispatch is selected only when `AFYX_GRAPH_NATIVE_PARSER` is exactly
`1`. The absent or disabled flag therefore selects the parser-backed fallback
in ordinary production. No CLI option, MCP configuration, installer/provider
configuration, package script, or CI workflow sets the flag.

All 31 native semantic language routes and all active syntax routes already
have parser-free implementations. The fallback remains for default selection,
compatibility, tests, and the transition oracle; it does not fill a known
semantic or syntax capability gap. The only selection blocker to unconditional
native extraction is changing/removing this default gate. Bootstrap, worker
grammar messages, packaging, and test/tool dependencies are separate cleanup
boundaries and do not block that dispatch change.

### Parser entry points and caller graphs

There are five production `getParser()` call sites:

1. `TreeSitterExtractor.extract()` for generic semantic fallback.
2. `CfmlExtractor` for the root CFML parser fallback.
3. `syntax-tokens.ts` for the tree-walk syntax fallback.
4. Async `guardsForFile()` for the branch-guard fallback.
5. Sync `guardsForFileSync()` for the branch-guard fallback.

Their production roots are:

```text
CLI async init/open/recreate -> indexAll/sync -> extraction dispatch
  -> default semantic adapter -> TreeSitterExtractor/CfmlExtractor -> getParser

MCP query-only openSync
  -> no initial bootstrap
MCP catch-up/watcher -> sync -> the same extraction/bootstrap path as CLI

UI browser bundle
  -> no parser
UI Node server -> tokenizeSource
  -> native grammar-backed highlighting, or default/generic syntax lookup

Engine direct native extractFromSource
  -> native extractor, no bootstrap
Engine async lifecycle/indexing
  -> initGrammars + needed-grammar loading, even in native mode

Syntax/branch guards -> default fallback -> getParser
```

Tests reach these same exported paths. The add-language scripts do not call the
repository helper; they import `web-tree-sitter` directly. Build and packaging
copy parser artifacts but do not call `getParser()`.

`TreeSitterExtractor` has six construction families, all default-fallback-only
after the completed native migrations:

1. Generic fallback in `tree-sitter.ts`.
2. Bare CFScript.
3. Embedded CFScript.
4. Embedded CFQuery.
5. Svelte/Vue/Astro JavaScript or TypeScript through `embedded-script.ts`.
6. Razor/Blazor C# regions.

The extractor and its adapters can be deleted only after the default path and
OLD-oracle dependency are closed. None is a native production requirement.

### Production roots

- CLI indexing uses async `AfyxGraph.init/open/recreate` and `indexAll/sync`;
  runtime bootstrap and conditional grammar loading still occur in native mode.
- MCP query-only startup uses `openSync`, so it does not bootstrap initially.
  Catch-up and watcher-driven `sync()` do bootstrap and load grammars.
- The browser UI does not bundle the parser. Node-side viewer highlighting uses
  native tokenization for grammar-backed formats.
- A grammarless/custom-format highlight can still initialize the runtime and
  attempt a parser lookup before returning plain/unclassified output. It never
  performs an active Tree-sitter parse and is an obsolete lookup candidate.
- Direct native `extractFromSource` avoids bootstrap; the async engine lifecycle
  does not.

Thus current native semantic parsing and native active syntax parsing are both
zero, while incidental parser initialization and loading remain nonzero.

### Bootstrap and worker graph

The remaining initialization graph is:

```text
AfyxGraph.init/open/recreate or ExtractionOrchestrator.indexAll/sync
  -> initGrammars()
  -> Parser.init() and runtime/cache setup
  -> detect project languages
  -> read only the needed grammar bytes
  -> parse-worker grammar transfer
  -> loadGrammarsForLanguages()
```

The in-process fallback loads needed grammars locally; sync loads grammars for
changed files; syntax and branch-guard fallback paths may load a grammar on
demand. Grammar loading is conditional by detected language, not an eager load
of all 29 files. The parse-worker pool is not parser-exclusive: it also hosts
native/kernel extraction and must remain. Its grammar buffers, load messages,
parser/language caches, and reset lifecycle are parser-exclusive and belong to
the later bootstrap/protocol closure.

### Staged grammar inventory (29/29)

All tracked staged grammars have the same reachability classification: a native
semantic route and native syntax route exist; default fallback remains
reachable; bootstrap can conditionally load the grammar; tests and add-language
tools can address it; `copy-assets` always stages it in `dist`; distribution
verification requires it; and it becomes a removal candidate only after
fallback, test-oracle, and bootstrap closure.

| # | Staged grammar |
| ---: | --- |
| 1 | `tree-sitter-arkts.wasm` |
| 2 | `tree-sitter-c.wasm` |
| 3 | `tree-sitter-c_sharp.wasm` |
| 4 | `tree-sitter-cfml.wasm` |
| 5 | `tree-sitter-cfquery.wasm` |
| 6 | `tree-sitter-cfscript.wasm` |
| 7 | `tree-sitter-cobol.wasm` |
| 8 | `tree-sitter-cpp.wasm` |
| 9 | `tree-sitter-dart.wasm` |
| 10 | `tree-sitter-erlang.wasm` |
| 11 | `tree-sitter-go.wasm` |
| 12 | `tree-sitter-java.wasm` |
| 13 | `tree-sitter-javascript.wasm` |
| 14 | `tree-sitter-kotlin.wasm` |
| 15 | `tree-sitter-lua.wasm` |
| 16 | `tree-sitter-luau.wasm` |
| 17 | `tree-sitter-nix.wasm` |
| 18 | `tree-sitter-pascal.wasm` |
| 19 | `tree-sitter-php.wasm` |
| 20 | `tree-sitter-python.wasm` |
| 21 | `tree-sitter-r.wasm` |
| 22 | `tree-sitter-ruby.wasm` |
| 23 | `tree-sitter-rust.wasm` |
| 24 | `tree-sitter-scala.wasm` |
| 25 | `tree-sitter-swift.wasm` |
| 26 | `tree-sitter-terraform.wasm` |
| 27 | `tree-sitter-tsx.wasm` |
| 28 | `tree-sitter-typescript.wasm` |
| 29 | `tree-sitter-vbnet.wasm` |

Objective-C and Solidity are additional default fallback grammars resolved from
the installed `tree-sitter-wasms` package, not from this 29-file directory.
That package contains 36 grammars, including unused assets. The existing
Windows release measurement is therefore larger than the staged-source count:
68 WASM files / 122,348,375 bytes, because `dist` grammars and installed-package
runtime WASM coexist.

### SyntaxNode coupling inventory (34/34)

| Primary role | Count |
| --- | ---: |
| Language adapters, default semantic fallback | 24 |
| Default semantic fallback core | 5 |
| Default syntax fallback | 1 |
| Default branch-guard fallback | 2 |
| Runtime/bootstrap (`grammars.ts`) | 1 |
| Build-time declaration (`web-tree-sitter.d.ts`) | 1 |
| **Total** | **34** |

The 24 language adapter files are:

```text
languages/arkts.ts       languages/c-cpp.ts      languages/cfscript.ts
languages/cobol.ts       languages/csharp.ts     languages/dart.ts
languages/erlang.ts      languages/go.ts         languages/java.ts
languages/kotlin.ts      languages/lua.ts        languages/nix.ts
languages/objc.ts        languages/pascal.ts     languages/php.ts
languages/r.ts           languages/ruby.ts       languages/rust.ts
languages/scala.ts       languages/solidity.ts   languages/swift.ts
languages/terraform.ts   languages/typescript.ts languages/vbnet.ts
```

The five fallback-core files are `tree-sitter.ts`, `tree-sitter-types.ts`,
`tree-sitter-helpers.ts`, `function-ref.ts`, and `cfml-extractor.ts`. The other
files are `syntax-tokens.ts`, `graph/branch-guards.ts`,
`graph/branch-guard-policy.ts`, `grammars.ts`, and `web-tree-sitter.d.ts`.

`grammars.ts` is the sole runtime value importer of `web-tree-sitter`. Thirty-
two files are structurally coupled to `SyntaxNode`/`Tree` for fallback behavior
but use those names only as TypeScript types: 29 use explicit `import type`, and
three use compilation-elided value-style imports in type positions. The final
file is the local declaration shim. Tests and tooling are outside this 34-source
count. Consequently the current count does not mean 34 active parser calls.

### Tests and development tooling

Parser-dependent tests cover differential OLD-oracle cells, extraction and
grammar bytes, kernel/grammar parity, UI highlighting, distribution contracts,
MCP initialization, and explicit parser-dependency presence. Closure must:

1. freeze or replace OLD-oracle output with normalized expectations;
2. isolate any retained differential harness as dev-only;
3. replace presence checks with parser/asset-absence distribution checks; and
4. avoid retaining production parser dependencies solely for tests.

`scripts/add-lang/dump-ast.mjs` and `scripts/add-lang/check-grammar.mjs` import
`web-tree-sitter` directly and resolve package/tracked grammars. They should be
deleted or isolated outside the production package at the final dependency
boundary; they are not a reason to retain a production runtime dependency.

### Dependency, packaging, and legal boundary

The direct production dependencies remain:

| Dependency | Version | Current reason retained |
| --- | --- | --- |
| `web-tree-sitter` | 0.25.10 | Runtime `Parser`/`Language`, runtime WASM, tests, and tools |
| `tree-sitter-wasms` | 0.1.13 | Package-resolved grammars, tests/tools, and installed WASM assets |

Both remain in `package-lock.json`; `tree-sitter-wasms` records its package
self-dependency, and `web-tree-sitter` has optional `@types/emscripten` peer
metadata. No other direct parser helper dependency was found.

`package.json` `copy-assets` copies every tracked grammar into `dist`, and the
package `files` rule includes all of `dist`. Normal engine distribution
verification requires every source grammar. Staged-bundle verification checks
a ten-grammar sentinel subset. Standalone bundles include production
`node_modules`, so the parser packages and their own runtime/WASM assets also
ship. These rules, rather than current native parse execution, explain why all
parser assets remain in release artifacts.

Do not edit `afyx-graph/THIRD_PARTY_NOTICES.md`,
`afyx-graph/LICENSES/THIRD_PARTY_ENGINE_MIT.txt`, or
`afyx-graph/engine/LICENSE` during technical closure. Release bundles still
require them. Grammar provenance/licenses are heterogeneous and partly recorded
only in `grammars.ts` comments. Phase 5H must reassess attribution after
technical removal; this audit makes no legal-removal conclusion.

### Closure DAG and rollback boundaries

```text
Native semantic + syntax independence (complete)
  -> A. Global Default Fallback Closure
       Make native semantic/syntax/guard dispatch unconditional.
       Freeze or replace the OLD oracle. Keep bootstrap temporarily.
  -> B. Parser Bootstrap & Worker-Protocol Closure
       Remove eager init roots, grammar reads/transfers/load messages, and
       parser caches/reset. Keep the native parse-worker pool.
  -> C. Parser Adapter & Tree-Walk Source Closure
       Delete TreeSitterExtractor, language adapters, AST helpers/types, and
       fallback syntax/branch walkers.
  -> D. Grammar & Packaging Closure
       Delete 29 tracked WASM, registry/copy requirements, package-resolved
       grammar use, and update distribution absence contracts.
  -> E. Runtime & Dev/Test Isolation
       Remove web-tree-sitter/tree-sitter-wasms from production manifest and
       lockfile; delete or isolate parser tooling and remaining oracles.
  -> Phase 5H legal/attribution review (separate boundary)
```

Each arrow is a rollback boundary. Expected metric changes are:

| Boundary | Expected delta |
| --- | --- |
| A | Default fallback `ACTIVE -> REMOVED`; six extractor construction families and five `getParser()` sites become unreachable from normal production dispatch |
| B | Parser initialization roots and production grammar load/transfer protocol `nonzero -> 0` |
| C | Production `SyntaxNode`/Tree-sitter adapter coupling `34 -> bootstrap/declaration remnants -> 0` |
| D | Tracked release grammar WASM `29 -> 0` and package grammar staging requirements removed |
| E | Production `web-tree-sitter` and `tree-sitter-wasms` requirement `true -> false` |

Native semantic and native active syntax parser reachability remain zero at
every boundary. Adapter deletion must not precede default/oracle closure;
grammar and package deletion must not precede bootstrap/protocol closure.

### Fallback readiness

All production semantic routes are native, all active production syntax routes
are parser-free, known semantic gaps are zero, native UI is clean, and fallback
exists for default compatibility/selection rather than missing capability.
Incidental bootstrap/loading and downstream tests, protocol, packaging, tools,
dependencies, and legal metadata do not block making native dispatch
unconditional; they remain explicit later boundaries.

`DEFAULT_FALLBACK_CLOSURE = READY`

The single recommended next implementation boundary is **Global Default
Fallback Closure**. It is not started by this audit.

## Native Semantic Contract Closure — partial implementation record

Baseline `66d4bf829f92e9ec39efe5efa721612df82ef940` disproved the readiness
statement above when production routing was exercised rather than only the
route-level corpus. The reversible native-default probe produced 55 failed,
265 passed, and 20 skipped files (214 failed, 5,462 passed, and 213 skipped
tests). A focused default/native matrix then isolated seven semantic failures
in eleven assertions. The fallback removal was rolled back; default routing,
parser bootstrap, grammar assets, dependencies, and legal records remain
unchanged.

This boundary added native structural facts for CommonJS callable exports;
exported, export-later, and default-export object callables; JavaScript and
TypeScript class fields; call-result receiver chains; React hook/HOC callable
wrappers; and same-file value references with local-shadow suppression.
Existing Redux, Zustand, Vuex, Pinia, UI Steps, and cross-tier synthesizers
consume those facts; their policy was not duplicated in extraction.

Focused native evidence is 92/92 across CommonJS, object members, class
fields, alias binding, receiver precision, React, the four store families, UI
Steps, cross-tier flow, and the complete 29-case value-reference precision
matrix. The same 92/92 matrix passes under the unchanged default route. No
filename, fixture-symbol, or native-to-parser fallback was introduced.

The full native campaign remains open. Its final-head result is 5,527 passed,
148 failed, and 213 skipped tests out of 5,888. At least 47 failed assertions
in 15 files remain semantic candidates after separating obvious Windows
EPERM and timeout noise. Focused reruns confirm gaps in type-alias object
members, local receiver typing, supertype/embedded-type conformance, and
Rust/Go chained factory resolution. Direct Go factory chains already pass, so
broad resolver relaxation would reduce precision and is not acceptable. The
semantic baseline is structurally identical but retains a native/default
search-score delta caused by runtime scoring.

| Contract | Default | Native |
| --- | --- | --- |
| ES modules / selected CommonJS contracts | PASS | PASS |
| Functions, object members, and class fields | PASS | PASS |
| Aliases and selected value references | PASS | PASS |
| Qualified receiver precision matrix | PASS | PASS |
| React / Redux / Zustand / Vuex / Pinia focused matrix | PASS | PASS |
| UI Steps / selected cross-tier matrix | PASS | PASS |
| Full production resolution and conformance | PASS | NOT READY |

```text
Route-level native semantic gaps: 7/11 failures -> 0/92 focused failures
Full production semantic gaps:    214 failed-test starting signal -> 47 semantic candidates remain
LEGITIMATE SEMANTIC REGRESSIONS:   > 0
```

Physical metrics intentionally remain unchanged: native semantic Tree-sitter
reachability is zero, while default fallback, parser bootstrap, 29 grammar
WASM assets, and 34-file `SyntaxNode`/parser type coupling remain present.
This record supersedes the earlier readiness conclusion:

```text
DEFAULT_FALLBACK_CLOSURE = NOT_READY
```

The single next boundary is **Native Resolution and Conformance Closure**.
It must close the confirmed cross-language receiver, return-type, and
conformance matrix before Global Default Fallback Closure is retried.

## Native Resolution and Conformance Closure

This boundary starts from `affaa0a042c0647150b8009c4ab39a5dee9f6598` and
keeps native routing opt-in. The conservative 47-candidate inventory did not
collapse into one resolver defect: the selected resolution/conformance cluster
is closed, while unrelated native capability families remain.

The first incorrect layers were small structural-fact gaps rather than a need
for a general type checker. Type-alias properties with callable signatures are
normalized to methods. Scala block-bodied local receivers retain their complete
body. Java methods and fields retain declared types, and `this.field.method()`
uses that declared type plus import FQN. Go methods retain cross-file receiver
ownership, factory return types, and explicit embedded-type conformance. Rust
split `impl` methods retain qualified ownership and associated factory chains
retain `Type::factory()` identity. PHP static factories and Ruby constructors
retain their receiver/instantiation identity. The existing bounded resolver and
conformance traversal then connect those facts; no public graph schema or
runtime inference was added.

Precision remains protected. The focused native matrix covers unrelated
same-named members, missing factory members, built-in/dynamic receivers,
ambiguous module names, local shadowing, and unsupported Rust `impl` targets.
An intermediate full run exposed two regressions: a Go generic receiver was
reduced to its type parameter and `impl Trait for dyn Trait` acquired a false
owner. Both were corrected at extraction and their existing negative contracts
pass. The final focused resolution/conformance selection is 49/49, the native
framework/UI selection is 86/86, the unchanged default selection is 61/61,
and the alias/value-reference precision suites are 35/35.

The original candidate recount is:

```text
semantic candidates in the original 15-file inventory: 47 -> 21
```

Twenty-six candidates in that inventory were closed by the shared fact,
ownership, receiver, return-type, and conformance changes. The full campaign
also proves that the old 47 was not exhaustive: 63 legitimate semantic/behavior
candidates remain in distinct families. They include lexical receiver/binding
precision (PHP properties, Python collections, store/local shadowing, and the
TypeScript `typeof` field case), extraction/framework synthesis, and
ranking/explore behavior. They are not safely fixable by further loosening the
name matcher or expanding this boundary.

The final opt-in native production campaign reports:

```text
passed:   5,558
failed:     117
skipped:    213
total:    5,888

classified failures:
  legitimate semantic/behavior candidates: 63
  Windows cleanup EPERM:                    38
  timeout:                                   9
  mode/score/tooling/performance noise:       7
```

This improves the preceding checkpoint from 5,527 passed / 148 failed by 31
tests, with no new final-run failure. The six remaining `resolution.test.ts`
failures are cleanup-only EPERM after their semantic assertions. Native
Tree-sitter semantic reachability remains zero.

The semantic baseline remains structurally identical. The two observed search
scores differ slightly (`parseToken` 105.5825881522508 versus
105.58770806565178; `./parser` import 2.7109981735576496 versus
2.6581462898477937). Because nodes, references, and edges are unchanged, this
is classified as runtime/index-derived floating score variation, not a graph
semantic correction; scores were not tuned.

The reversible production-routing probe was not run. Its acceptance
precondition requires zero legitimate semantic regressions, and the full native
campaign still contains valid capability gaps. Default fallback, parser
bootstrap, all 29 grammar WASM assets, dependencies, and the 34-file
`SyntaxNode`/parser coupling therefore remain unchanged.

```text
Route-level native semantic gaps: 0 -> 0
Full production semantic gaps:    >0 -> >0
LEGITIMATE SEMANTIC REGRESSIONS:   63
DEFAULT_FALLBACK_CLOSURE = NOT_READY
```

The single recommended next semantic boundary is **Native Lexical Receiver
Precision Closure**. It should establish one bounded binding/scope primitive
before any framework-synthesis or default-routing work begins.

## Native Lexical Receiver Precision Closure

This boundary starts from `7d9ed471af476768b7fb2e17d51d0168d70d8938`
and keeps native routing opt-in. The 63 legitimate candidates from the prior
campaign were decomposed before implementation:

```text
Lexical receiver/binding: 40
Framework/extraction:     16
Ranking/explore:           6
Other:                     1
```

First-broken-layer analysis found bounded lexical facts rather than a need for
general dataflow. PHP instance-property calls had dropped the `$this` root;
Python module assignments had dropped initializer signatures and treated class
and tuple targets as module bindings; optional JS/TS chains had dropped `?.`
receiver separators; object-literal callables used container-qualified identity
and could be duplicated; Python parameter annotations could add a spurious
function-reference edge; and Rust retained the outer `self` call-result path
where the established contract collapses it.

The native fact layer now preserves PHP arrow receiver chains, bounded Python
initializer signatures and module ownership, optional static member paths, and
bare object-literal callable identity with one declaration. Python quoted and
unquoted parameter annotations share the existing receiver-type inference
without adding a callee edge for the annotation itself. Rust still preserves
associated factory chains while collapsing only the established
`self.method().member()` shape. Existing store alias/destructuring and shadow
logic required no dataflow expansion once callable identity was corrected.
No scanner, parser grammar, public graph schema, or fallback-routing change was
made.

Precision evidence covers typed and untyped PHP properties, deep PHP property
chains, same-name local interference, collection-like Python names versus real
project classes, store selector aliases and local/parameter/sibling shadows,
optional versus ordinary chains, unrelated same-named object members, Python
class/module ownership, quoted annotations, and Rust local/deep/call-result
receivers. Static PHP factory, Rust associated factory, and the representative
Ruby/Kotlin/Scala receiver contracts remain green.

Focused native results are 64/64 for the selected lexical contracts, 72/72 for
alias/value/factory protection, and 19/19 for the language-specific protection
set. The framework/UI protection set is 102/104; its two Express failures are
the same known non-lexical framework-synthesis candidates present at the OLD
checkpoint. The default six-fixture semantic baseline passes, native UI passes
20/20, and native CLI/MCP smoke passes all 21 checks. TypeScript typecheck,
clean production/UI build, viewer plus 29-grammar artifact verification, and
`git diff --check` pass. The clean build changed no tracked UI source.

The final opt-in native production campaign reports:

```text
passed:   5,596
failed:      79
skipped:    213
total:    5,888

stable failure classification:
  legitimate semantic/behavior candidates: 22
  Windows cleanup EPERM:                    38
  timeout-only:                             12
  mode/score/tooling/performance noise:       7
```

Relative to the OLD campaign, 41 failed assertions became green: all 40
lexical candidates plus one object-member framework/extraction assertion that
shared the corrected identity primitive. Three newly observed failures are
timeout-only git/sync cases; there is no new semantic regression. The remaining
legitimate inventory is 15 framework/extraction, six ranking/explore, and one
other candidate:

```text
Legitimate semantic/behavior candidates: 63 -> 22
Lexical receiver/binding:                 40 -> 0
```

The normal semantic snapshot remains green. The opt-in native snapshot remains
non-green on already separate structural and runtime-score gaps, so this
boundary does not tune search weights or claim global semantic closure. Native
semantic Tree-sitter reachability remains zero. Route-level gaps remain zero;
default fallback, parser bootstrap, 29 grammar WASM assets, and the existing
`SyntaxNode`/parser coupling remain unchanged. Because 22 legitimate non-lexical
candidates remain, the production-default routing probe was deliberately not
run.

```text
Route-level native semantic gaps:       0 -> 0
Lexical receiver gaps:                 40 -> 0
Full production semantic/behavior gaps: 63 -> 22
DEFAULT_FALLBACK_CLOSURE = NOT_READY
```

The single recommended next boundary is **Native Extraction & Framework
Synthesis Closure**. Ranking/explore, fallback removal, parser bootstrap, and
later phases must not begin as part of this boundary.

## Native Extraction & Framework Synthesis Closure

This boundary starts from `f28ea56dcef93dc38c311429a472de2646562d38`
with native routing still opt-in. The frozen legitimate inventory was 15
framework/extraction candidates, six ranking/explore candidates, and one Other
candidate. The selected 15 comprised five ArkTS facts, one Gin middleware
fact, three Lombok facts, one nested JavaScript declarator fact, two Nix option
path facts, one React Router fact, and two Express/UI Steps facts.

First-broken-layer analysis located the selected defects in native fact
extraction and bounded compile-time synthesis, not resolution or product
relationship construction. TypeScript-family expression-bodied and curried
arrow ranges could overrun or truncate their callable bodies; same-position
nested calls were emitted in the wrong order for established framework
consumers. ArkTS lost decorators on early member paths and rejected leading-dot
DSL calls. Go interpreted `func` in function types as a declaration. Nix
dropped quotes from static attribute paths and rejected static hyphenated
segments such as `home-manager`. Java's parser-backed path synthesized Lombok
members, but the native path had no equivalent compile-time synthesis.

The native extractor now bounds expression-bodied and curried arrows, applies
the outermost-first same-position call ordering only to TypeScript-family
languages, preserves ArkTS decorators and DSL calls, and excludes Go function
types from declarations. Nix retains quoted static segments and validates
quoted or hyphenated attribute paths structurally. A bounded Afyx-owned Lombok
synthesizer adds only members promised by recognized annotations, preserves
explicit members, and respects static/final access rules; a negative annotation
gate leaves ordinary Java unchanged. No framework name, fixture path, route
literal, fallback, ranking, parser bootstrap, grammar, dependency, or legal
record was changed.

The two known Express/UI Steps gaps close through the generic callable-range
and deterministic nested-call ordering corrections; no Express-specific
heuristic was added. Positive and negative evidence covers ArkTS component and
DSL facts, nested declarator functions, Gin middleware, Lombok accessors/logs/
builders and ordinary Java, quoted and hyphenated Nix option paths, React
Router, and UI Steps API/server relationships. The selected focused matrix is
64/64 PASS. The final shared-extraction guardrail records 713 semantic
assertions PASS; its six remaining failures occur only during Windows temporary
directory cleanup (`CLEANUP_ONLY_EPERM`). The protected framework matrix
records 315 semantic assertions PASS, apart from cleanup-only EPERM and one
pre-existing Java anonymous-class contract outside the selected Lombok scope.

The single Other candidate is classified `RANKING_EXPLORE`: native extraction
produces the relevant graph facts, while the observable difference begins in
context entry selection, expansion, and budgeting. It is therefore folded into
the ranking/explore boundary and intentionally not changed here.

The one requested full native production campaign completed before the final
narrow Nix hyphen-path, TypeScript-family-only ordering, and ordinary-Java
Lombok-gate refinements:

```text
passed:   5,604
failed:      71
skipped:    213
total:    5,888
```

That campaign improved the prior checkpoint by eight passing assertions. Its
remaining failures include the frozen ranking/explore contracts, cleanup
EPERM, timeout/tooling/performance cases, and historical native framework
contracts outside the selected 15 (including RTK Query, Spring events, Vue
store, and Java anonymous-class behavior). Those non-selected contracts are
not claimed closed. Final-head focused evidence supplements the campaign and
proves the selected inventory at 15 -> 0 without reopening the expensive full
campaign.

Default semantic baseline remains green across six fixtures. Native structural
output remains green while its known floating score values remain in the
ranking/explore boundary. Default and native CLI/MCP smoke each pass all 21
checks. TypeScript typecheck, clean production/UI build, viewer artifact check,
and the 29-grammar inventory pass. Clean build did not modify or delete tracked
source files.

```text
Route-level native semantic gaps:        0 -> 0
Lexical receiver gaps:                   0 -> 0
Framework/extraction gaps:              15 -> 0
Ranking/explore gaps:                    6 -> 6
Other:                                   1 -> 0 (reclassified RANKING_EXPLORE)
Frozen legitimate selected inventory:   22 -> 6
```

This is closure of the frozen selected inventory, not global native production
parity. Native semantic Tree-sitter reachability remains zero. Default fallback,
parser bootstrap, 29 grammar WASM assets, existing `SyntaxNode` coupling, and
parser dependencies remain unchanged.

```text
DEFAULT_FALLBACK_CLOSURE = NOT_READY
```

The single recommended next boundary is **Native Ranking & Explore Contract
Closure**.

## Afyx V1 Contract Closure Decision Gate

This audit starts from `3e6b624505680e264af3b5f681be0f806a84648d`
and replaces the provisional `22 -> 6` statement with a product-contract
inventory. That old number measured only the frozen lexical/framework campaign:
15 selected framework assertions closed while six previously classified
ranking/explore assertions remained. It was never a global production-parity
count.

The ranking accounting contained a bookkeeping error. The six assertions were
two legacy-control assertions for deprioritization, three assertions for one
explore-allocation invariant, and one cross-call dedup assertion. The separate
real-index context-contract assertion was then reclassified as ranking/explore
without increasing six to seven. The authoritative assertion count for that
old set is therefore seven, representing four behavior families.

The current authoritative audit uses behavior families rather than counting
multiple assertions for one defect. It assesses eleven semantic/product
differences and three non-product noise families:

| Capability | Native difference and observable impact | Disposition | Evidence |
|---|---|---|---|
| Deprioritize legacy control | Native ranks product code ahead of peripheral `usage()` helpers even without configuration; configured deprioritization, recall, direct targeting, path isolation, and explore matcher assertions pass. | `NATIVE_CORRECTION` | The only two failures are legacy controls requiring the inferior unconfigured ordering, at lines 168 and 226 of `deprioritize-config.test.ts`. |
| Explore allocation | A qualifying target receives only a cluster stub, leaves reserved bytes unused, and reduces useful source delivered under an unchanged hard cap. | `V1_REQUIRED` | Three CG-21 assertions independently verify render mode, delivered bytes, and the general reservation-spend invariant. |
| Cross-call deduplication | A second explore call re-sends source lines already delivered instead of replacing all withheld spans with pointers. | `V1_REQUIRED` | Real payroll index reports repeated lines 68-72 in `payslip_builder.go`. |
| Real-index context selection | Native changes selected/expanded context, code blocks, or budgeting—not merely a score field. | `V1_REQUIRED` | `context-contract` real-index record differs; its contract contains roots, nodes, entry points, related files, stats, and code-block ranges, but no floating scores. |
| Floating search scores | Small runtime/index-derived score differences remain while the structural six-fixture baseline and CLI/MCP product paths remain green. | `LEGACY_COMPATIBILITY_ONLY` | Same relevant structural result; score-for-score tuning has no demonstrated product outcome. |
| Expo Router attribution | Navigation resolves, but native reports same-file component intermediates in `via` where the established bridge boundary expects none. | `POST_V1` | Targeted native run: all other Expo Router tests pass; one attribution assertion differs. No v1 product documentation advertises this specialized attribution shape. |
| RTK Query synthesis | Native extracts two of four endpoint forms, so some generated hook-to-endpoint relationships are absent. | `POST_V1` | Targeted native run: positive matrix reports 2/4; negative hand-written-hook precision test passes. Useful framework enrichment, but not part of the minimum documented v1 contract. |
| Spring Event synthesis | Native emits no publish-to-listener edges for the tested listener forms. | `POST_V1` | Targeted native run expects three `OrderShippedEvent` listeners and receives none; clean non-event control passes. Specialized framework enrichment. |
| Vue-store member recall | Native omits the Vuex `SET_TOKEN` mutation while other tested Vuex/Pinia members are present. | `POST_V1` | Targeted native run fails only at the missing mutation in the positive store matrix. Specialized framework enrichment. |
| Vue-store precision | Native emits `doThing` from an ordinary, non-exported `actions` object outside a store. This is false graph data that can contaminate search/context. | `V1_REQUIRED` | Targeted negative control expects zero and receives one node. |
| Java anonymous classes | Native omits the abstract base method before it can connect the anonymous override, losing a core definition/type relationship. | `V1_REQUIRED` | Targeted end-to-end run cannot find the base abstract method. This is core Java graph correctness, not merely framework compatibility. |
| Windows cleanup | Temporary directories can fail deletion after semantic assertions complete. | `ENVIRONMENT_OR_TOOLING_NOISE` | Repeated `EPERM` in teardown; no product output failure. |
| Timeout-only cases | Git/sync/subprocess cases sometimes exceed their test deadline without a stable product differential. | `ENVIRONMENT_OR_TOOLING_NOISE` | Prior campaign classification and no reproducible semantic delta. |
| Mode/tooling/performance noise | Parser-warning harness, old-Git probes, and timing ceilings can differ by mode or host without a semantic product delta. | `ENVIRONMENT_OR_TOOLING_NOISE` | Prior campaign classification; excluded from semantic implementation. |

Authoritative counts, at behavior-family granularity:

```text
TOTAL ASSESSED DIFFERENCE FAMILIES = 14
SEMANTIC / PRODUCT DIFFERENCES     = 11

V1_REQUIRED                       = 5
NATIVE_CORRECTION                 = 1
LEGACY_COMPATIBILITY_ONLY         = 1
POST_V1                           = 4
ENVIRONMENT_OR_TOOLING_NOISE      = 3
```

Only these five behaviors block semantic freeze:

| V1-required behavior | Product value | Correctness | Token efficiency | Implementation scope | Regression risk |
|---|---|---|---|---|---|
| Correct real-index context selection/expansion/budgeting | HIGH | HIGH | HIGH | MEDIUM | HIGH |
| Spend explore reservations on relevant source within the existing hard cap | HIGH | MEDIUM | HIGH | MEDIUM | MEDIUM |
| Never resend already-delivered lines across explore calls | HIGH | MEDIUM | HIGH | SMALL | MEDIUM |
| Reject ordinary non-store `actions` members | MEDIUM | HIGH | MEDIUM | SMALL | LOW/MEDIUM |
| Preserve Java abstract definitions and anonymous overrides | MEDIUM | HIGH | MEDIUM | MEDIUM | MEDIUM |

The four `POST_V1` framework capabilities remain useful backlog items, but
existing tests alone do not make them part of the minimum v1 product contract.
They do not block Phase 5F. The native deprioritization ordering must be retained
rather than regressed to satisfy legacy control assertions, and floating numeric
scores must not be tuned unless a future result-set, ordering, or context-output
measurement proves material harm.

Performance measurement is ready once these five semantics are closed. Existing
deterministic hooks cover cold indexing, warm incremental sync, query/search and
context latency, database size, peak RSS, MCP first response, and bundle size
(`benchmark.mjs`); context selection/traversal cases with correctness digests and
counts (`benchmark-context.mjs`); search-layer ranking cost
(`benchmark-search.mjs`); reconciliation (`benchmark-extraction.mjs`); and daemon
startup/attach/round-trip lifecycle (`benchmark-daemon.mjs`). Explore allocation
diagnostics already expose per-file rank, allowance, render mode, emitted chars,
source totals, and the hard output cap. The later performance boundary should
compare output digests/counts and delivered relevant/duplicate bytes alongside
latency and RSS so a faster but lower-quality implementation cannot win.

The audit reused the 5,888-test campaign, the 713-assertion extraction
guardrail, semantic baseline, CLI/MCP smoke, and build evidence. It reran only
the four ranking/context test files and five historical framework test files
needed to resolve classification. No full campaign, build, UI, smoke, or parser
audit was repeated. No production source, fallback, bootstrap, grammar,
dependency, ranking, or legal file changed.

```text
V1_SEMANTIC_CONTRACT = IMPLEMENT_REQUIRED_GAPS
```

The single recommended next boundary is **Afyx V1 Required Behavior Closure**.

## Afyx V1 Required Behavior Closure

This consolidated closure starts from
`06edea15a27ed87c2ecce86944758b4e36a58385`; its implementation checkpoint is
`62621a0639f42db0eaac69ef087436d851cdba88`. Afyx Graph impact evidence bounded
the work to native fact extraction/resolution, explore allocation/render dedup,
and their focused contracts. No repository-wide implementation rewrite was
needed.

The first broken layers and fixes were:

- **Real-index context:** native TypeScript/JavaScript call facts dropped the
  explicit `new` receiver in `new Type().method()`, and resolution consequently
  rejected the chain before context selection. Native facts now preserve that
  receiver and the matcher resolves only explicit constructor-call chains; the
  existing guard against arbitrary unknown factory chains remains intact.
- **Explore allocation:** lower-ranked reservations were held at their nominal
  value even when the corresponding source could not spend them, while a
  qualifying whole-file render could not use the already-bounded shared
  overshoot. Payable debt is capped by actual source size and merit buys may use
  the remaining shared headroom. The existing source/render ceilings and
  displacement guard remain hard limits.
- **Cross-call dedup:** product rendering inherited the utility's eight-line
  suppression threshold, so a fully covered short span was emitted again.
  Product rendering now withholds fully covered spans from one line onward and
  retains pointers plus genuinely new spans; the reusable utility keeps its
  threshold behavior for partial overlap.
- **Vue-store precision:** generic extraction treated an ordinary non-exported
  object named `actions` as a store container. Store members now require a
  recognized `defineStore(...)` call or a structurally supported Vuex export.
  Real Pinia/Vuex positives remain green; missing `SET_TOKEN` recall remains
  explicitly post-v1.
- **Java abstract/anonymous correctness:** the Java member declaration scan
  began too late to retain modifiers before multiline/bodiless methods, so the
  abstract base definition disappeared before relationship recovery. The scan
  now starts at the declaration boundary, preserving abstract definitions and
  statically represented anonymous overrides without speculative inference.

Final-head focused evidence:

```text
real-index context contract                 77/77 PASS
explore allocation CG-21                     8/8 PASS
cross-call source dedup                      27/27 PASS
Vue-store positive + negative precision       2/2 PASS
Java abstract/anonymous focused               1/1 PASS
allocation/displacement/invariant follow-up  53/53 PASS
shared extraction/context regression cone  1053 PASS
post-assertion cleanup failures                 15 CLEANUP_ONLY_EPERM
TypeScript typecheck                           PASS
clean production/UI build                      PASS
CLI/MCP smoke, default                       21/21 PASS
CLI/MCP smoke, native                        21/21 PASS
default semantic fixtures                      6/6 PASS
git diff --check                               PASS
```

The one final native production campaign was run after the five behavioral
fixes and before a final diagnostic-only reservation-accounting correction:

```text
PASS     5,622
FAIL        54
SKIP       213
TOTAL    5,889
```

The diagnostic correction was then covered at final HEAD by the 53/53 focused
allocation/displacement/invariant run; repeating the full campaign would not
resolve another semantic risk. Remaining failures classify as the retained
native deprioritization correction, legacy floating-score compatibility,
documented post-v1 framework behavior (Expo attribution, RTK Query, Spring
Event enrichment, Vuex mutation recall, and other already-known native
extensions), or environment/tooling cases such as cleanup EPERM, host timing,
old-Git/path probes, and parser-warning harness behavior. The historical
1,500-character explore fixture is outside the exact qualifying CG-21 V1
contract and remains in the later performance/token boundary. `UNKNOWN` product
failures are zero. The 213 skips are unchanged conditional/platform/optional
suite exclusions; no focused V1-required behavior is skipped and this closure
adds no skip.

Native semantic fixtures remain structurally identical; only the previously
frozen runtime/index-derived floating search scores differ. No ranking tuning
was performed.

```text
Real-index context          PASS
Explore allocation          PASS
Cross-call dedup            PASS
Vue-store precision         PASS
Java anonymous semantics    PASS

V1_REQUIRED                 5 -> 0
V1_SEMANTIC_CONTRACT        FROZEN
```

Native parser reachability, default fallback, parser bootstrap, 29 grammar
WASM assets, parser dependencies, and legal/attribution state are unchanged.
The exact next boundary is **Native Performance & Token Efficiency Baseline**.

## Native Performance & Token Efficiency Baseline

The authoritative campaign starts at
`59f0a2a66bacff1688534247e20f979183a234fb`. Benchmark observability is frozen
at `1f671dabc8af5bf8f8088dc6e947e48834cafdc3`: the context harness now records
p95, selected file paths, and duplicate source bytes, and the new explore
harness measures first/repeat delivery through the existing CG-4 diagnostic.
Neither harness changes production behavior.

### Environment and method

```text
OS                         Microsoft Windows 10.0.26300, x64
CPU                        AMD64 Family 25 Model 117, 12 logical CPUs
Node                       v26.7.0 (AFYX_GRAPH_ALLOW_UNSAFE_NODE=1)
npm                        11.19.0
TypeScript                 5.9.3
Git                        2.55.0.windows.3
campaign scratch           %TEMP%/afyx-phase5f-performance-20261008
execution                  sequential; no benchmark contention
default/native switch      AFYX_GRAPH_NATIVE_PARSER unset / 1
watch and daemon           disabled where the harness owns indexing
provider/model tokens      NOT_MEASURED
CPU profile / process I/O  NOT_MEASURED
```

Broad measurements use five fresh-process cold indexes and five warm-sync
samples over the same seeded 301-file TypeScript project (2,373 nodes / 5,435
edges). Context uses nine calibrated rounds over 292 files / 2,136 nodes /
4,617 edges. Explore uses nine fresh sessions over the same 19-file Go payroll
fixture. MCP uses five lifecycle rounds over independently indexed copies of
that same fixture. Graph, DB, search, impact, watcher, WAL, extraction, and
daemon harnesses preserve their result digests beside timings. Historical Phase
5E values below are reference-only even though the runtime, CPU count, and
fixture definitions remain compatible.

### Broad default/native comparison

| Metric | Phase 5E historical | Default measured | Native measured | Native delta | Default/native p95 | Result evidence | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Cold index | 2,422.55 ms | 2,467.02 ms | 2,453.36 ms | -13.66 ms / -0.55% | 2,506.41 / 2,506.92 ms | 301 / 2,373 / 5,435 both | within noise |
| Peak RSS | 351.52 MB | 375.71 MB | 425.34 MB | +49.63 MB / +13.21% | 378.84 / 425.95 MB | same project counts | measured native overhead |
| Warm sync, five files | 994.37 ms | 1,034.62 ms | 1,028.88 ms | -5.74 ms / -0.55% | 1,092.22 / 1,033.75 ms | same indexed fixture | within noise |
| Search | 6.00 ms | 6.21 ms | 6.19 ms | -0.02 ms / -0.32% | not emitted | 20 results both | no change |
| Callers / callees | — | 0.05 / 0.03 ms | 0.05 / 0.03 ms | 0 | not emitted | 2 / 2 results both | no change |
| Impact / dependents | — | 0.04 / 0.02 ms | 0.04 / 0.02 ms | 0 | not emitted | 5 / 2 results both | no change |
| Context | 41.53 ms | 39.93 ms | 44.78 ms | +4.85 ms / +12.15% | focused harness below | stable counts | mixed/noise-sensitive |
| MCP initialize | 494.17 ms | 507.62 ms | 500.80 ms | -6.82 ms / -1.34% | 524.40 / 522.92 ms | protocol success | within noise |
| MCP first result | 1,473.84 ms | 1,503.70 ms | 1,477.53 ms | -26.17 ms / -1.74% | 1,510.09 / 1,528.62 ms | tool success | within noise |
| DB size | 3.49 MB | 3.49 MB | 3.53 MB | +0.04 MB / +1.15% | n/a | mode-specific native facts | small increase |

The cold-index latency and query results do not support a speed claim. The
49.63 MB median peak-RSS increase is larger than each mode's spread and is the
principal measured optimization candidate; it is not a correctness or baseline
reliability blocker.

### Context and explore efficiency

All eight graph-selection context cases retain identical default/native digests.
The structured result is identical (`e78654b9990b`): nine nodes, five code
blocks, 564 source bytes, two files, five ranges, zero duplicate ranges, and
zero duplicate source bytes.

| Context case | Default median / p95 | Native median / p95 | Native delta | Digest / output |
| --- | ---: | ---: | ---: | --- |
| Structured | 26.243 / 31.328 ms | 23.793 / 25.529 ms | -2.451 ms / -9.34% | same; 564 source bytes |
| Dedup-heavy selection | 46.414 / 54.564 ms | 44.897 / 52.710 ms | -1.517 ms / -3.27% | `b3f166986ffb` both |
| Prose architecture | 50.238 / 61.234 ms | 55.375 / 59.278 ms | +5.137 ms / +10.23% | `b07bb4a9524d` both |
| Markdown with code | 18.921 / 24.802 ms | 18.663 / 28.825 ms | -0.258 ms / -1.36% | 1,487 / 1,560 bytes |

Native formatted context adds 73 bytes to each markdown form and 454 bytes to
JSON. Structured content remains identical, so this is mode-specific rendered
metadata rather than missing or duplicated source. It is not converted into a
provider-token claim.

Explore remains deterministic within each mode and preserves the payroll
domain/cycle/store core. The fourth relevant first-call file differs by mode:
default selects the payslip builder and native selects the HTTP payroll handler.
Both are relevant to the query; the already-frozen product contracts remain the
correctness gate.

| Explore metric | Default | Native | Native delta |
| --- | ---: | ---: | ---: |
| First call median / p95 | 61.28 / 300.49 ms | 64.79 / 299.27 ms | +3.51 ms / +5.73% median |
| Repeat call median / p95 | 61.38 / 66.85 ms | 63.96 / 71.45 ms | +2.58 ms / +4.20% median |
| First response / source | 18,425 B / 14,559 chars | 17,994 B / 14,161 chars | -431 B / -398 chars |
| Repeat response / source | 10,827 B / 5,781 chars | 9,515 B / 4,424 chars | -1,312 B / -1,357 chars |
| First distinct files / ranges | 4 / 7 | 4 / 11 | same files count |
| Repeat distinct files / ranges | 3 / 8 | 3 / 11 | same files count |
| Repeat duplicate source bytes | 0 | 0 | identical |
| Withheld source / pointer bytes | 12,855 / 1,777 | 12,415 / 1,857 | mode-specific ranges |
| First unused allocation | 0 | 0 | identical full use |
| Repeat unused allocation | 6,419 chars | 7,776 chars | +1,357 chars |
| First/repeat hard-cap utilization | 0.94 / 0.55 | 0.92 / 0.49 | bounded below cap |

The repeat call does not re-deliver a single previously served source line. It
uses pointers for held source and still delivers three files of new relevant
source. The unused repeat allowance reflects exhausted useful novel source on
this fixed query, not an invitation to pad the response or trigger compensating
manual Reads. Actual downstream provider reads were not instrumented.

### MCP, daemon, and shared-core baseline

The focused MCP lifecycle has byte-identical default/native payloads:
initialize 6,664 B, controlled three-tool `tools/list` 3,075 B, valid/repeat
search 117 B, invalid tool 93 B, and invalid arguments 127 B.

| MCP metric | Default median | Native median | Native delta | Observed range, default/native |
| --- | ---: | ---: | ---: | --- |
| Initialize | 475.091 ms | 483.519 ms | +8.428 ms / +1.77% | 467.050–493.588 / 478.181–505.871 |
| Tools list | 340.585 ms | 337.240 ms | -3.345 ms / -0.98% | 332.395–351.874 / 327.537–354.891 |
| First valid search | 225.761 ms | 231.768 ms | +6.007 ms / +2.66% | 220.432–228.499 / 218.104–233.814 |
| Repeated search | 0.931 ms | 0.818 ms | -0.113 ms | 0.799–1.136 / 0.788–0.820 |
| Full lifecycle | 1,054.582 ms | 1,076.894 ms | +22.312 ms / +2.12% | 1,047.587–1,097.464 / 1,059.939–1,083.657 |

Current-only shared-core measurements, labelled `MEASURED`, are:

- extraction reconciliation over 2,000 files: 2.264–3.548 ms median across
  no-op, add/change/delete, rename, and batch cases; every digest stable;
- search primitives: 3.42–74.94 microseconds for ordinary parsing/segmentation,
  1,766.32 microseconds for ranking 2,000 candidates, and 3.885–11.817 ms for
  20,000-path extraction workloads;
- impact/affected tests: 0.42–249.21 microseconds per operation, including the
  2,000-result high-fanout case; every digest stable;
- graph: 34 workloads, identical default/native cardinalities, 28 identical
  digests, and six mode-specific ID/edge-order digests with identical returned
  node/edge counts; no empty or new unknown product result;
- DB: 4,960 nodes / 14,376 edges / 160 files in 4,583,424 bytes; point read
  8.07 microseconds and FTS search 8.016 ms per operation;
- watcher policy: 0.205 ms single event and 55.296 ms for 1,000-event
  coalescing; common stable digest;
- WAL: policy decisions 0.02–0.84 microseconds per operation; real durable
  backpressure cycle 81.868 ms per operation;
- daemon: cold start 397.172 ms, first attach 15.833 ms, second attach 1.084 ms,
  ping round trip 0.477 ms, shutdown 7.102 ms, and stale-lock restart 514.590
  ms; stable lifecycle digests.

### Resource footprint, confidence, and candidates

```text
dist/                         75.13 MB       MEASURED
grammar WASM                  65.03 MB / 29  MEASURED
web-tree-sitter installed      5.51 MB       MEASURED
tree-sitter-wasms installed   49.37 MB       MEASURED
win32-x64 release archive     46.67 MB       MEASURED
controlled DB              3.49/3.53 MB      MEASURED default/native
provider tokens                    —         NOT_MEASURED
CPU profile / process I/O           —         NOT_MEASURED
large real-repository campaign      —         NOT_MEASURED (Phase 8 / Track D)
```

Five-sample p95 values are effectively the observed maximum and are directional,
not distribution guarantees. Nine-round context/explore medians and p95s are
more stable, but host scheduling still explains mixed single-digit deltas.
Absolute sub-millisecond MCP deltas are noise. No percentage is presented as a
provider-token saving.

Ranked measured optimization candidates, with no implementation in this
boundary:

1. profile the +49.63 MB native cold-index peak RSS before parser/runtime
   removal, separating retained historical runtime from native structures;
2. profile MCP readiness/catch-up, where startup/list/first call dominate while
   the repeated call remains below 1 ms;
3. explain the explore first-call cold tail (~300 ms p95 vs ~65 ms median)
   before changing allocation or output quality;
4. review whether the extra native formatted-context metadata is useful before
   attempting to remove 73–454 serialized bytes;
5. retain WAL durability semantics unless an I/O profile shows avoidable work.

No measurement defect, correctness regression, or unknown product failure
blocks the baseline. Semantic campaigns were not repeated: the frozen V1
correctness evidence remains authoritative and every benchmark carries counts,
digests, or deterministic payload checks.

```text
NATIVE_PERFORMANCE_BASELINE = FROZEN
```

The exact next boundary is **Global Default Fallback Closure**.

## Global Default Fallback Closure

This routing-only closure starts from
`4599115b94d4f66e0efe46e0ae586ffc1fe3327b`. It makes the already-frozen
Afyx-native extraction, syntax, and branch-guard paths unconditional in
production. It does not remove the historical parser source, bootstrap,
worker protocol, grammar assets, dependencies, native kernel, or attribution.

### Routing inventory and final ownership

| Route / switch | Previous behavior | Final classification | Final behavior |
| --- | --- | --- | --- |
| `extractFromSource` | `AFYX_GRAPH_NATIVE_PARSER=1` selected native facts; otherwise parser/kernel fallback | `PRODUCTION_ROUTING` | named and CFML families always use Afyx-native facts; special/file-only extractors remain explicit; unsupported input returns the established bounded error |
| Svelte/Vue/Astro embedded scripts | env-selected native facts or `TreeSitterExtractor` | `PRODUCTION_ROUTING` | native embedded fact seam only, including incomplete blocks and absolute coordinate remapping |
| Razor code regions | env-selected native facts or synthetic parser wrapper | `PRODUCTION_ROUTING` | native C# region facts only |
| syntax highlighting | env-selected scanner or grammar parse | `PRODUCTION_ROUTING` | native classifier only; unsupported languages return the existing unclassified result |
| file/source branch guards | env-selected native reader or grammar tree | `PRODUCTION_ROUTING` | native reader only; Explore no longer warms parser grammars |
| `AFYX_GRAPH_NATIVE_PARSER` | restored parser-backed production behavior when unset/`0` | `TEST_ONLY` spelling retained temporarily | ignored by all production source; unset, `0`, and `1` have identical routing |
| `TreeSitterExtractor` and parser syntax/guard entry points | implicit production fallback plus differential oracle | `DEV_ORACLE` | reachable only through explicit oracle APIs/direct construction for later removal verification |
| `CfmlExtractor` parser delegation | historical fallback implementation | `DEV_ORACLE` | retained source, no production dispatch caller |
| parser bootstrap/worker/WASM/dependencies | active infrastructure | transitional physical state | intentionally unchanged for the next boundary |

The production source tree contains zero reads of
`AFYX_GRAPH_NATIVE_PARSER`. Native failure cannot silently fall back to a
parser. The old differential tests now name and call the historical oracle
explicitly instead of defining “default” as parser-backed behavior.

### Newly exposed differences

- The default UI syntax route initially exposed an O(definitions × tokens)
  lookup and exceeded the 400 ms large-file contract. The first broken layer
  was native syntax definition classification, not extraction semantics. A
  token-offset index plus bounded JS/TS lexical declaration pass restored the
  focused test to 240 ms while preserving syntax differentials.
- Structural semantic fixtures remain identical. The semantic-baseline script
  reports only the already-frozen runtime/index-derived search-score values
  (`105.5825881522508` vs `105.58770806565178`, and
  `2.7109981735576496` vs `2.6581462898477937`). Classification:
  `LEGACY_SCORE_COMPATIBILITY`; no ranking change was made here.
- The full campaign continues to expose the previously classified native
  corrections, post-v1 framework gaps, ranking/explore expectations,
  parser-warning oracle expectations, Windows cleanup `EPERM`, and host timing
  cases. None is a new V1-required or unknown routing defect.

### Final evidence

```text
focused routing/extraction/syntax/guards       42/42 PASS
large-file syntax + syntax/routing follow-up  48/48 PASS
focused regression cone                      801 PASS
cleanup-only failures                           6 EPERM
full production/default campaign            5,623 PASS
classified failures                             56
classified skips                               213
full total                                   5,892
TypeScript typecheck                           PASS
clean production/UI build                      PASS
UI artifact check (29 grammars)                 PASS
CLI/MCP smoke, production default             21/21 PASS
CLI/MCP smoke, env=1                          21/21 PASS
semantic structural contract                    PASS
semantic exact-score snapshot      FROZEN SCORE-ONLY DIFF
git diff --check                                PASS
```

The 56 full-campaign failures contain no `V1_REQUIRED` or `UNKNOWN` product
failure. They are the frozen semantic families above plus cleanup/timing/tooling
cases; no skip was added by this closure. The previous native semantic and
performance baselines were reused and the performance campaign was not
repeated. Only the default-switch-specific large-file syntax sanity was run.

### Independence state and decision

```text
production default parser fallback     0
production native routing              unconditional
native semantic parser reachability    0
native syntax parser reachability      0
named parser-backed native routes      0
special-format parser routes           0

parser bootstrap                       PRESENT
parser adapter/source                  PRESENT (DEV_ORACLE/TEST_ONLY)
grammar WASM                           29
web-tree-sitter                        PRESENT
tree-sitter-wasms                      PRESENT
SyntaxNode coupling                    transitional (32 source files)

V1_REQUIRED failure                    0
UNKNOWN product failure                0
GLOBAL_DEFAULT_FALLBACK                CLOSED
```

The exact next boundary is **Parser Bootstrap & Worker-Protocol Closure**.

## Parser Bootstrap & Worker-Protocol Closure

This runtime-architecture closure starts from
`ce194f1c48d557a1abaabd582d15d5e7d91231e9`; the verified implementation
checkpoint is `81695bb7659bd05a06f00e9fe0e36d5e6e933191`. Production extraction was
already unconditionally Afyx-native, but process startup and the extraction
worker pool still initialized Tree-sitter, read grammar WASM, transferred those
bytes to every worker, and waited for a parser-specific readiness reply. Those
operations were dead production prerequisites, not semantic dependencies.

### Bootstrap inventory and ownership

| Component | Previous role | Classification | Final state |
| --- | --- | --- | --- |
| `AfyxGraph.init/open/recreate` | initialized the Tree-sitter runtime before DB/lifecycle work | `PARSER_BOOTSTRAP` | parser initialization removed |
| `ExtractionOrchestrator.indexAll/sync` | initialized parsers, selected preload languages, read grammar bytes, and loaded grammars for in-process extraction | `PARSER_BOOTSTRAP` | all production grammar initialization/read/preload work removed |
| `ParseWorkerPool` | sent `load-grammars` plus language/byte payloads and waited for `grammars-loaded` | `PARSER_PROTOCOL` | accepts generic `ready`; queue, growth, timeout, recycle, crash recovery, and concurrency retained |
| extraction worker | loaded grammars, maintained parser reset counters, and filtered parser-WASM abort output | `PARSER_BOOTSTRAP` / `PARSER_PROTOCOL` | starts native extraction directly and reports generic `ready` |
| query, resolver, and store workers | independent query/resolution/storage concurrency | `GENERIC_WORKER_INFRA` | unchanged |
| `grammars.ts`, explicit branch-guard and syntax-token oracle entry points | historical parser differential/oracle | `DEV_ORACLE` / `TEST_ONLY` | retained; invoked only through explicit test/dev APIs |
| grammar byte reader and preload-language helper | supported production grammar transfer | `DEAD` after routing closure | removed with obsolete focused tests |

The extraction worker now has the bounded protocol `ready`, `parse`,
`parse-result`, `shutdown`, and `shutdown-ack`. Spawn and respawn perform module
load plus handler registration only. No grammar fields, buffers, parser caches,
load messages, or parser readiness state cross the worker boundary. The
existing pool still isolates CPU work, scales on demand, prewarms for bulk
indexes, accepts late results safely, recycles isolates, and replaces crashed
or timed-out workers.

### Validation and classification

```text
focused worker lifecycle/protocol            17/17 PASS
native extraction core                         5/5 PASS
extraction/reconciliation ground truth          5/5 PASS
daemon attach contract                          2/2 PASS
shared daemon lifecycle                        12/12 PASS
MCP initialize behavioral assertions             PASS
MCP initialize cleanup-only failures          3 EPERM
CLI/MCP built-artifact smoke                  21/21 PASS
TypeScript typecheck                             PASS
clean production/UI build                       PASS
UI/artifact check (29 grammars retained)         PASS
git diff --check                                 PASS
semantic structural contract                     PASS
semantic exact-score snapshot       FROZEN SCORE-ONLY DIFF
```

The semantic run reproduced only the already-frozen runtime/index-derived
ranking values documented in the preceding closure; graph structure, nodes,
edges, lookup, context, impact, and affected-test results were unchanged. The
three MCP initialize failures occurred in Windows temporary-directory cleanup
after their assertions (`fs.rmSync`, `CLEANUP_ONLY_EPERM`). Therefore:

```text
V1_REQUIRED failure       0
UNKNOWN product failure   0
```

The prior native semantic and performance baselines were reused. No full
semantic campaign, Benchmark A, Benchmark B, or new performance claim was run.

### Independence state and decision

```text
production parser bootstrap          0
production grammar initialization    0
production grammar transfer          0
production parser worker protocol    0

generic worker pool                  PRESERVED / PASS
native worker functionality          PASS
parser adapter/source                PRESENT (DEV_ORACLE/TEST_ONLY)
SyntaxNode coupling                  32 source files (transitional)
grammar WASM                         29 (retained)
web-tree-sitter                      PRESENT (retained)
tree-sitter-wasms                    PRESENT (retained)

PARSER_BOOTSTRAP                     CLOSED
PARSER_WORKER_PROTOCOL               CLOSED
```

The exact next boundary is **Parser Adapter & Tree-Walk Source Closure**.

## Parser Adapter & Tree-Walk Source Closure

This source-eradication boundary starts from
`e0bb1caa2b53226fc28b2c1dfce8f36035542b75`. Production routing, parser
fallback, bootstrap, and worker protocol were already closed; this boundary
removes the obsolete parser implementation that remained solely as an OLD
oracle.

### Dependency cone and source ownership

The retained cone contained `TreeSitterExtractor`, its generic language
configuration registry, `SyntaxNode` helper/types, function-reference tree
walking, CFML parser delegation, and parser-backed syntax/branch readers. The
only live behavior inside that cone was bounded source preprocessing for
C/C++/C#/COBOL/VB.NET plus UI readings for call sites, triggers, loops,
decorators, and member types.

Final ownership is:

| Surface | Final state |
| --- | --- |
| Production extraction dispatch | `extract.ts`, Afyx-native facts and explicit special-format extractors |
| C/C++/C#/COBOL/VB.NET preprocessing | small native source-preprocessor registry; no AST types |
| Syntax classification | scanner/fact based only |
| Branch conditions | existing native branch reader |
| Call-site/trigger/loop/decorator/member-type UI facts | bounded source-native readers |
| Node identity shared by Drupal | `node-id.ts` |
| CFML dialect sniffing | native CFML facts module |

### Removed source and oracle migration

Removed source includes `tree-sitter.ts`, `tree-sitter-types.ts`,
`tree-sitter-helpers.ts`, `function-ref.ts`, `cfml-extractor.ts`, and 24
language-specific AST configuration modules. The remaining five language
files contain only source preprocessing required by the native grammar path.
The broad native-versus-`TreeSitterExtractor` differential test was retired;
syntax and branch tests now assert the Afyx contract directly. Product tests
that imported the historical host now import the native extraction facade.

`grammars.ts`, `web-tree-sitter.d.ts`, the 29 grammar WASM files, package
dependencies, and staging/copy rules remain intentionally present. They are
`GRAMMAR_PACKAGING` / `RUNTIME_DEPENDENCY` inputs for the next boundaries and
are not production extraction, syntax, or guard paths.

### Validation evidence

```text
TypeScript typecheck                                      PASS
native syntax + guard contract                         78/78 PASS
extraction/resolution/context/impact cone             197/197 PASS
worker/default-routing/UI artifact cone                53/53 PASS
clean production and UI build                              PASS
UI artifact validation, retained grammars              29/29 PASS
CLI/MCP smoke                                           21/21 PASS
git diff --check                                            PASS
```

The frozen V1 semantic contract and native performance baseline were reused;
the full 5,8xx semantic campaign and performance campaign were not repeated
because targeted final-source evidence exposed no unresolved semantic or
performance risk. No new failure or skip was introduced in the executed cone.

### Source/reachability audit

```text
TreeSitterExtractor production caller       0
TreeSitterExtractor retained source         0
production SyntaxNode coupling              0
parser AST/tree-walk production path        0
parser-backed syntax production path        0
parser-backed guard production path         0

grammar WASM                               29
web-tree-sitter                       PRESENT
tree-sitter-wasms                     PRESENT

V1_REQUIRED failure                         0
UNKNOWN product failure                     0
PARSER_ADAPTER_AND_TREE_WALK_SOURCE     CLOSED
```

The exact next boundary is **Grammar & Packaging Closure**.

## Grammar & Packaging Closure

This boundary starts from `29dbaab326ec6008b2eae5d5fa8f737e7cf0d841`.
Production fallback, parser bootstrap/worker protocol, and parser-backed source
were already closed. The remaining 29 tracked grammar binaries and their
loading, copying, verification, test-oracle, and release ownership were dead
packaging residue.

### Inventory and removal

| Category | Before | After |
| --- | ---: | ---: |
| Tracked grammar WASM | 29 files / 68,192,092 bytes | 0 files / 0 bytes |
| `dist` grammar WASM | 29 | 0 |
| Windows archive grammar WASM | tracked copies plus dependency grammars | 0 |
| Grammar copy/staging rules | 1 | 0 |
| Production grammar resolution/load/cache APIs | present in `grammars.ts` | 0 |
| Package-resolved grammar use | present | 0 |

The complete `src/extraction/wasm/` inventory was deleted. `grammars.ts` now
owns only language detection and native-support metadata; parser runtime,
grammar caches, grammar paths, load/error/reset APIs, and their public exports
were removed. The UI language classifier now asks the native syntax classifier
directly.

Obsolete grammar-only tooling was also removed:

- `scripts/add-lang/check-grammar.mjs`;
- `scripts/add-lang/dump-ast.mjs`;
- `scripts/kernel-parity.mjs` (the removed fallback differential);
- `__tests__/kernel-grammar-parity.test.ts`;
- the no-longer-needed local `web-tree-sitter.d.ts` declaration.

Behavioral tests no longer bootstrap grammars. The C++ raw-string regression
tests now assert the native behavior, including successful extraction through
a legal 16-character delimiter, rather than preserving the removed WASM
scanner defect.

### Packaging and artifact composition

`copy-assets` now copies only the database schema. Distribution metadata and
UI artifact checks no longer require a grammar directory or grammar count.
Both `dist` and staged bundles reject grammar WASM. The Windows bundle retains
the dependency declarations for the next boundary but excludes the unused
`tree-sitter-wasms` package from the shipped runtime. The three remaining WASM
entries in that archive are `web-tree-sitter` runtime binaries, not grammar
assets; runtime dependency removal is explicitly deferred.

Measured artifact footprint:

```text
tracked grammar WASM     68,192,092 bytes / 29 -> 0 bytes / 0
dist                     77,318,737 bytes       -> 9,099,061 bytes
dist grammar WASM        29                     -> 0
win32-x64 archive        48,932,591 bytes       -> 39,054,071 bytes
archive grammar WASM     dependency + staged    -> 0
npm pack dry-run         2,263,794 bytes compressed / 9,270,237 unpacked
npm pack grammar WASM    0
```

### Validation and failure classification

```text
TypeScript typecheck                                  PASS
focused packaging/native/syntax regressions         122/122 PASS
distribution grammar-exclusion contract                9/9 PASS
main extraction guardrail                            649 semantic PASS
main extraction cleanup-only failures                  6 EPERM
clean production/UI build                              PASS
UI/distribution artifact verification                  PASS
CLI/MCP smoke                                         21/21 PASS
Bash installer syntax + validate-only                   PASS
PowerShell installer validate-only                      PASS
git diff --check                                        PASS
```

All six guardrail failures occurred after their assertions while Windows was
removing temporary directories (`CLEANUP_ONLY_EPERM`). The frozen V1 semantic
contract, prior full semantic campaign, and native performance baseline were
reused; no full semantic or performance campaign was repeated for this static
asset/packaging closure.

```text
V1_REQUIRED failure              0
UNKNOWN product failure          0

tracked grammar WASM             0
shipped grammar WASM             0
grammar staging/copy             0
package-resolved grammar use     0
production grammar runtime use   0
web-tree-sitter                  PRESENT (deferred)
tree-sitter-wasms                PRESENT in manifest/lock (deferred)

GRAMMAR_AND_PACKAGING            CLOSED
```

The exact next boundary is **Runtime & Dev/Test Isolation**.

## Runtime & Dev/Test Isolation

This boundary starts from `b8cf14f49a97e9ef01da9d07e5b6a08d93e06fc6`.
The production parser path, parser worker protocol, adapter/tree-walk source,
grammar assets, and grammar packaging were already closed. The remaining
runtime packages and parser-specific launch/test scaffolding had no production
caller and were obsolete.

### Dependency and tooling closure

| Reference | Previous scope | Final classification | Final state |
| --- | --- | --- | --- |
| `web-tree-sitter` | direct production dependency; unused runtime binaries entered the Windows bundle | dead runtime dependency | removed from manifest, lockfile, install tree, and artifacts |
| `tree-sitter-wasms` | direct production dependency; bundle script removed it after install | dead packaging dependency | removed from manifest, lockfile, install tree, and artifacts |
| `wasm-runtime-flags.ts` and `--liftoff-only` relaunch | parser-WASM OOM workaround | dead parser bootstrap | removed; CLI starts directly |
| Node 25 parser-WASM block | parser-WASM OOM guard | dead runtime restriction | removed; that parser checkpoint temporarily used Node `>=20.0.0`, superseded by the evidence-based 22.5 floor in Runtime / Distribution Closure |
| parser package pin/runtime-flag tests | transition-only test scaffolding | dead test tooling | retired or rewritten as absence/distribution contracts |
| `AFYX_GRAPH_HOST_PPID` | process supervision contract | product lifecycle behavior | retained under `mcp/ppid-watchdog.ts` |
| historical kernel/legal references | provenance and attribution evidence | legal/historical evidence | retained unchanged |

Direct, transitive, dev-only, and test-only dependency state is now absent for
both parser packages. `npm ls web-tree-sitter` and
`npm ls tree-sitter-wasms` both report an empty tree. The old bundle-time
`tree-sitter-wasms` deletion is gone. The distribution contract now rejects
either historical package or `tree-sitter.wasm` anywhere in the staged product
while correctly accepting a zero-production-dependency bundle with no
`node_modules` directory.

Worker crash/timeout recovery and PPID/liveness supervision remain product
behavior. Their parser-specific comments and test environment switches were
removed, but their native worker and lifecycle semantics were not weakened.

### Artifact composition and footprint

```text
                                      before         after
dist bytes                          9,099,061     9,081,461
npm pack compressed                2,263,794     2,257,459
npm pack unpacked                  9,270,237     9,251,556
win32-x64 archive                 39,054,071    37,307,059
installed parser dependency footprint 54.88 MB          0

dist parser runtime files                  0             0
npm pack parser runtime files              0             0
archive parser runtime files               3             0
grammar WASM                               0             0
```

The footprint values are cheap artifact sanity evidence, not a replacement for
the frozen Benchmark A/B methodology. The frozen semantic contract and native
performance baseline were reused; no full semantic or performance campaign was
repeated for dependency-only closure.

### Validation and final state

```text
TypeScript typecheck                                      PASS
focused dependency/distribution/lifecycle tests     72 PASS / 1 SKIP
native extraction/syntax/branch guards                   86/86 PASS
targeted CLI/MCP lifecycle            28 PASS / 4 SKIP / 3 CLEANUP_ONLY_EPERM
clean production and UI build                                PASS
CLI/MCP smoke                                             21/21 PASS
distribution contract                                      9/9 PASS
npm pack parser runtime / WASM                              0 / 0
win32-x64 archive parser runtime / WASM                     0 / 0
Bash bundle/installer syntax                                  PASS
Bash + PowerShell installer validate-only                     PASS
Afyx Graph repository validation                              PASS
npm dependency-tree audit                                    EMPTY
git diff --check                                               PASS
```

The three targeted lifecycle failures occurred only in Windows temporary
directory cleanup after the MCP sub-project scenarios completed; isolated
rerun reproduced the same `rmSync` `EPERM` cleanup location. They are
`ENVIRONMENT_OR_TOOLING_NOISE`, not product or V1-required failures.

```text
V1_REQUIRED failure                         0
UNKNOWN product failure                     0

production parser fallback                  0
production parser bootstrap                 0
parser worker protocol                      0
parser adapter/source                       0
production SyntaxNode coupling              0
grammar WASM                                0
web-tree-sitter                             0
tree-sitter-wasms                           0
third-party parser runtime                  0

PARSER_RUNTIME_AND_DEV_TEST_ISOLATION  CLOSED
WEB_TREE_SITTER                            0
TREE_SITTER_WASMS                          0
```

The exact next boundary is **Native Kernel Closure**.

## Native Kernel Closure

This boundary starts from `89302e45c8222e64c18885499f8aa556ae103960`.
The optional Rust/N-API kernel was reachable only as an acceleration path: a
missing, disabled, deferred, stale, or failing kernel always selected the
Afyx-native TypeScript extractor. `POST_PASSES` was empty, framework extraction
already forced decoded TypeScript behavior, and the native C function-pointer
sweep retained a record-identical TypeScript implementation. It therefore had
no unique correctness or frozen V1 contribution.

```text
KERNEL_VALUE = NONE
```

The frozen native performance baseline remains the product performance
authority. No evidence established a material kernel benefit sufficient to
justify a second language toolchain, platform binary loading, dedicated worker
transport, 74 Cargo packages, or 66,249,394 tracked bytes. Speculative optional
acceleration is not retained.

### Inventory and disposition

| Component | Previous role | Reachability | Ownership | Final state |
| --- | --- | --- | --- | --- |
| Rust extractors and N-API entrypoint | `PERFORMANCE_ONLY` optional extractor | production when a compatible binary was present | Afyx glue plus third-party Rust crates and grammar implementations | removed |
| `Cargo.toml`, `Cargo.lock`, `build.rs` | `BUILD_ONLY` native build | release/CI build | 74 resolved third-party packages | removed |
| generated Dart/Kotlin/Lua/Scala grammar C | `VENDORED_THIRD_PARTY` | compiled into optional kernel | 23 files / 65,228,661 bytes | removed |
| TypeScript kernel loader/router/decoder/layout | `HISTORICAL_COMPATIBILITY` and performance transport | parse worker and store boundary | Afyx transition code coupled to native ABI | removed |
| raw kernel buffers/counts and store-worker decode | `PERFORMANCE_ONLY` | fresh-index worker path | kernel-specific protocol | removed |
| native C function-pointer sweep | `PERFORMANCE_ONLY` | optional resolution acceleration | Rust implementation plus N-API boundary | removed; established TypeScript path retained |
| build script, bundle staging, Cargo CI | `BUILD_ONLY` | build/release | native toolchain and binary distribution | removed |
| parity/defer/materialization tests and fixtures | `TEST_ONLY` | tests only | kernel-specific oracle/infrastructure | removed |
| historical legal/provenance evidence | legal history | no runtime reachability | evidence only | retained unchanged for Phase 5H |

Direct crate families removed were N-API (`napi`, `napi-derive`, `napi-build`),
Tree-sitter core/language crates, `sha2`, `regex`, `libc`, `cc`, and
`tree-sitter-language`, together with their transitive lock graph. Their prior
MIT or MIT/Apache-2.0 upstream licensing remains historical evidence; none is
now a shipped kernel dependency. Vendored/generated grammar source and its
embedded licenses were removed from the technical product tree; repository
legal records were intentionally not cleaned in this boundary.

### Runtime, build, and distribution closure

The parse worker now calls `extractFromSource` directly. Extraction admission,
the store writer, and retry paths carry only normal `ExtractionResult` objects.
The bundle script cannot stage a kernel, the package exposes no kernel build
command, and normal CI no longer owns a Cargo/kernel job.

Artifact audit after a clean build:

```text
tracked kernel source / Cargo payload     0
dist kernel/native-library matches        0
npm pack kernel/Cargo/vendor/native       0
win32-x64 kernel/Cargo/vendor/native      0
win32-x64 native libraries                0

dist bytes                         8,995,476
npm pack compressed                2,233,424
npm pack unpacked                  9,162,832
win32-x64 archive                 37,276,780
```

The four npm paths containing `cargo-workspace` are Afyx's JavaScript framework
resolver, not Cargo manifests, vendor payload, native source, or libraries.

### Validation and final state

```text
focused extraction/worker/c-fnptr/distribution         93/93 PASS
resolution/context/impact/affected ground truth      106/106 PASS
CLI/MCP smoke                                          21/21 PASS
TypeScript typecheck                                        PASS
clean production/UI build                                  PASS
distribution contract                                  10/10 PASS
npm pack                                                     PASS
win32-x64 bundle                                             PASS
```

The default semantic fixture still differs only in the two previously frozen
runtime/index-derived floating search scores (`parseToken` and `./parser`);
graph shape, nodes, edges, relations, and all non-ranking contract content are
unchanged. This is reused frozen evidence, not a kernel-removal regression.

```text
V1_REQUIRED failure                     0
UNKNOWN product failure                 0

third-party kernel ownership            0
third-party native crates               0
vendored/generated grammar source       0
kernel runtime dependency               0

NATIVE_KERNEL_CLOSURE              CLOSED
THIRD_PARTY_KERNEL_OWNERSHIP             0
```

The exact next boundary is **Runtime / Distribution Closure**.

## Runtime / Distribution Closure

This boundary starts from `4c8bd1fedef937a2dff8572171201a1121719eff`.
The release builder previously downloaded Node `v24.16.0`, staged a platform
`node`/`node.exe`, and ran `npm ci --omit=dev` inside the bundle. That ownership
was unnecessary: compiled Afyx Graph has zero production npm dependencies, and
its only platform runtime requirement is Node's built-in APIs.

The effective runtime floor is Node.js `22.5.0`, not the former manifest floor
of Node 20. Afyx's sole database backend is `node:sqlite`, introduced in Node
22.5. The package engine constraint, distribution contract, CLI hard block,
recovery banner, and SQLite diagnostic now state the same evidence-based floor.

### Runtime inventory and final contract

| Component | Previous ownership | Final ownership | Final state |
| --- | --- | --- | --- |
| `node` / `node.exe` | bundled general runtime downloaded per target | external platform prerequisite | absent from all product artifacts |
| staged `node_modules` | shipped dependency tree created by bundle build | none | absent; production dependency count is zero |
| TypeScript/Vitest/jsdom/types | build/dev/test workspace packages | build/dev/test only | retained outside product artifacts |
| Windows launcher | bundled-runtime launcher | Afyx launcher resolving `node` on PATH | actionable missing-runtime error; CLI enforces version |
| POSIX launcher | bundled-runtime launcher | Afyx launcher resolving `node` on PATH | actionable missing-runtime error; CLI enforces version |
| installer runtime checks | required bundled runtime file | launcher/metadata integrity | no runtime provisioning or bundled-runtime requirement |

Final runtime contract:

```text
Runtime                    external Node.js
Minimum version            22.5.0
Resolution                 node from PATH
Bundled runtime            none
Missing runtime            explicit diagnostic and exit 1
Unsupported runtime        CLI compatibility banner and exit 1
Unsafe override            existing AFYX_GRAPH_ALLOW_UNSAFE_NODE behavior
Child/command exit status  propagated by both launchers
```

### Distribution composition and measurements

The clean build produced 1,336 `dist` files / 8,996,595 bytes. Artifact scans
found no bundled Node, `node_modules`, parser runtime, grammar WASM, kernel
source/runtime, native library, or other executable binary.

| Artifact | Compressed bytes | Unpacked bytes / entries | Forbidden payload |
| --- | ---: | ---: | ---: |
| npm pack | 2,233,523 | 9,163,270 / 1,361 entries | 0 |
| `win32-x64` archive | 2,806,607 | 9,001,254 / 1,341 files | 0 |
| `linux-x64` archive | 2,142,695 | 1,368 archive entries | 0 |

The Windows archive and installer were measured locally, including a runtime
root containing spaces. The Windows and POSIX launchers both returned `1.0.0`
with the host runtime, emitted the pinned missing-runtime diagnostic with an
empty runtime PATH, and propagated an unknown-command exit code of 1. Linux and
macOS archive logic share the statically validated POSIX launcher; native OS
execution remains CI evidence rather than a fabricated local claim.

### Validation

```text
runtime/distribution focused tests                    23/23 PASS
CLI semantic contract                                 10/10 PASS
CLI/MCP built-artifact smoke                           21/21 PASS
component/validator unit tests                    14 PASS, 1 SKIP
repository and component validators                        PASS
TypeScript typecheck                                       PASS
clean production/UI build                                 PASS
Bash syntax (Git Bash)                                     PASS
PowerShell syntax                                          PASS
Windows installer install/validate                         PASS
npm pack and payload scan                                  PASS
win32-x64 bundle/launcher/payload scan                      PASS
linux-x64 bundle/POSIX launcher/payload scan                PASS
```

The frozen V1 semantic contract, native parser performance baseline, parser /
grammar closure, and native-kernel closure evidence were reused. No semantic,
parser, grammar, kernel, ranking, legal, or identity behavior changed, so their
expensive campaigns were not rerun.

```text
V1_REQUIRED failure                    0
UNKNOWN product failure                0

bundled Node runtime                   0
shipped node_modules                   0
bundled general-purpose runtime        0
third-party parser runtime             0
third-party grammar assets             0
third-party kernel runtime             0

RUNTIME_DISTRIBUTION_CLOSURE      CLOSED
BUNDLED_NODE                            0
SHIPPED_NODE_MODULES                    0
```

Historical legal records remain unchanged for Phase 5H. The exact next
boundary is **Final Phase 5F Artifact Audit**.

## Final Phase 5F Artifact and Product Viability Audit

Audit branch: `afyx/native-phase5f-parser-grammar`. Canonical starting HEAD:
`57b48cef89d42002e7acb30085b5d58c84923e1d`. The authoritative final HEAD is
the closure commit containing this section and is also recorded in the final
task report; no production correction was required by the audit.

### Final artifact boundary

The audit rebuilt both release archives from a clean `dist`, created a fresh
npm pack, installed the Windows archive through the real kit installer, and
scanned the tracked product tree, `dist`, npm pack, Windows staged bundle, and
Linux archive.

```text
unwanted third-party product runtime dependencies    0
bundled Node                                         0
shipped node_modules                                 0
bundled general-purpose runtime                      0
tracked third-party grammar WASM                     0
shipped third-party grammar WASM                     0
third-party parser runtime                           0
vendored third-party grammar source                  0
third-party UI runtime/assets                        0
third-party native kernel                            0
new unwanted third-party product dependencies        0
native executables                                   0
native libraries (.dll/.so/.dylib/.node)             0
```

Both engine and UI production dependency counts are zero. The native viewer is
three files / 85,615 bytes and contains zero Svelte, XYFlow, fontsource, Archivo,
or IBM Plex runtime/asset markers. Historical legal/provenance evidence remains
unchanged for Phase 5H.

### Fresh installed product

Artifact:
`afyx-graph/engine/release/afyx-graph-win32-x64.zip`.

Fresh install root:
`%TEMP%/afyx-phase5f-final-20261009/run-161c5db0a1e5451980075981c95db276/fresh install`.

External Node.js `26.7.0` satisfied the documented `>=22.5.0` prerequisite.
The installed launcher returned version `1.0.0`, rendered canonical help, and
preserved a failing child exit code. With Node absent from PATH it emitted the
actionable install diagnostic and exited 1. Injecting `22.4.0` into the
installed artifact's immutable runtime-version input exercised the actual boot
guard: it rendered the unsupported-version banner and exited 1.

### Real repository initialization and queries

The fixture is a temporary copy of the real engine's complete `src` and
`__tests__` trees plus package/compiler manifests: 795 files / 10,744,750
bytes. It is not a synthetic one-file project. The audit added one isolated
probe to the copied `node-version-check.ts`, initialized a local Git baseline,
and never changed the canonical repository.

Fresh installed-artifact `init --yes` created only project state and indexed:

```text
files indexed               771
nodes                    29,402
edges                    71,850
internal index duration    16.2 s
wall-clock init duration   26.243 s
database bytes         86,695,936
database backend       node-sqlite / WAL
index state            complete
pending refs           0
freshness after Git baseline sync  FRESH
```

Known-positive installed-artifact query evidence:

| Operation | Target | Required fact | Result |
| --- | --- | --- | --- |
| Search | `isSupportedNodeVersion` | function in `src/bin/node-version-check.ts` | found at line 20 |
| Context | `isSupportedNodeVersion runtime validation` | useful source and relationships | 9 symbols / 6 files / 7 relationships; source included |
| Callers | `isSupportedNodeVersion` | CLI/test callers | 4 callers including `afyx-graph.ts` and `nodePrerequisiteBanner` |
| Callees | `nodePrerequisiteBanner` | call to version predicate | `isSupportedNodeVersion` found |
| Impact | `isSupportedNodeVersion` | downstream code/tests | 6 nodes / 7 edges including CLI and two test files |
| Affected tests | `src/bin/node-version-check.ts` | known importing tests | two tests found: CLI semantic and node-version contracts |

Silent empty known-positive results: zero.

### Installed MCP, reopen, and incremental behavior

The installed `lib/dist/bin/afyx-graph.js` was launched with the documented
external Node runtime in direct MCP mode (no development import path). MCP
`initialize` returned `afyx_graph` version `1.0.0`; `tools/list` exposed the
controlled search/callers/explore/status surface. Real search, contextual
explore, and callers requests all returned the known symbol/relationship. EOF
shutdown exited 0. A second complete MCP lifecycle also passed; its recorded
writer PID was dead after exit, and the stale-lock acquisition contract allowed
the restart normally.

Reopening the same database reported `complete` / `FRESH`, retained the original
index timestamp without a full rebuild, and returned the positive query again.

Incremental evidence renamed the copied `phaseFiveAuditProbe` to
`phaseFiveAuditProbeUpdated` and added a call to `isSupportedNodeVersion`.
Before sync the tracked change was `STALE`; incremental sync processed exactly
one modified file / six nodes in 1.1 seconds. The old exact symbol count became
zero, the new symbol appeared, and its new callee relationship appeared. After
the fixture commit plus metadata sync, freshness was `FRESH`. The audit then
reverted the fixture commit, synced that one file again, proved the inverse
symbol transition, and left the fixture Git-clean and `FRESH`.

### Platform, validation, and governance

```text
Windows     MEASURED_LOCAL
Linux       STATICALLY_VALIDATED
macOS       STATICALLY_VALIDATED
```

Git Bash execution or source inspection is not claimed as native Linux/macOS
execution. No matching branch CI run existed for the canonical audit HEAD.

Executed gates:

```text
fresh artifact install / launcher / negative runtime cases       PASS
real init/index/query/MCP/reopen/incremental lifecycle            PASS
runtime/distribution/CLI semantic focused tests              33/33 PASS
TypeScript typecheck                                              PASS
clean production/UI build                                        PASS
distribution verifier (dist and staged Windows bundle)            PASS
repository and component validators                               PASS
Bash and PowerShell syntax                                        PASS
npm pack and Windows/Linux artifact scans                          PASS
git diff --check                                                   PASS
```

Frozen V1 semantic, parser/grammar, runtime-isolation, kernel, and
performance-baseline evidence was reused; the huge semantic campaign was not
rerun. Native Linux/macOS execution and a physical Node 22.4 binary were not
run. The unsupported-version boot guard was instead executed from the installed
artifact with its version input injected to 22.4.0.

```text
V1_REQUIRED failure                 0
NATIVE_CORRECTION                   0
LEGACY_COMPATIBILITY_ONLY           0
POST_V1                             0
ENVIRONMENT_OR_TOOLING_NOISE        1  (Windows CIM process enumeration denied)
UNKNOWN product failure             0

EXPECTED_PLATFORM_SKIP              0
EXPECTED_MODE_SKIP                  0
OPTIONAL_INTEGRATION_SKIP            0
KNOWN_TEST_INFRA_SKIP               0
TEMPORARY_SKIP                      0
UNJUSTIFIED_SKIP                    0
```

Artifact footprint:

| Artifact | Final measurement |
| --- | ---: |
| `dist` | 1,336 files / 8,996,599 bytes |
| npm pack | 2,233,600 compressed / 9,163,420 unpacked bytes / 1,361 entries |
| Windows archive | 2,806,600 compressed / 9,001,258 unpacked bytes / 1,341 files |
| Linux archive | 2,142,595 compressed bytes / 1,368 entries |

```text
AFYX_PRODUCT_INSTALL_SMOKE           = PASS
AFYX_REPO_INIT_SMOKE                  = PASS
AFYX_REAL_END_TO_END_PRODUCT_SMOKE   = PASS

PHASE_5F_ARTIFACT_AUDIT              = PASS
PHASE_5F                             = COMPLETE
```

This does not activate Technical Alpha. The canonical maturity sequence remains
Phase 5G, Phase 5H, and Phase 5I; only Phase 5I PASS enters Technical Alpha. The
exact next boundary is **Phase 5G — Legacy Product Identity / Historical
Artifact Eradication**, not started by this audit.
