/** Native source syntax classification for the viewer. */

import { Language } from '../types';
import { extractNativeFacts } from './native/fact-extractor';
import { scanSource, type NativeToken } from './native/scanner';
import { scanCobolSource } from './native/cobol-facts';
import { classifyNativeCfmlSyntax } from './native/cfml-facts';
import { findRazorCodeRegions } from './razor-regions';

/* ------------------------------------------------------------- the classes -- */

/**
 * Every class a token can carry, in wire order.
 *
 * `other` is punctuation and whitespace both. The design spec lists them apart
 * (`punct` vs the gaps) but they paint identically — plain ink — and splitting
 * them would roughly double the token count on a dense line to express a
 * difference nothing draws.
 */
export const SYNTAX_TOKEN_CLASSES = [
  'other',
  'ident',
  'comment',
  'string',
  'keyword',
  'number',
  'type',
  'def',
] as const;

export type SyntaxTokenClass = (typeof SYNTAX_TOKEN_CLASSES)[number];

/** A classified run of the source, by JS string index. Half-open. */
export interface SyntaxSpan {
  start: number;
  end: number;
  cls: SyntaxTokenClass;
}
/* --------------------------------------------------------------- regions -- */

/**
 * A stretch of a file written in a different language from the file itself.
 *
 * Single-file components are the only case: a `.svelte`, `.vue` or `.astro`
 * file has no tree-sitter grammar of its own here, but its `<script>` block —
 * where every symbol the engine indexed in that file lives — is ordinary
 * TypeScript or JavaScript. The extractors already delegate exactly this way,
 * so the viewer reads a component's code with the same grammar the graph was
 * built from. The surrounding markup stays unclassified, which under a
 * near-monochrome theme costs the recession on tag names and attribute strings
 * and nothing else.
 */
export interface SyntaxRegion {
  start: number;
  end: number;
  language: Language;
}

const TS_LANG_ATTR = /lang\s*=\s*["'](ts|typescript)["']/i;
/** Astro's frontmatter: a `---` fence at the very top of the file. */
const ASTRO_FRONTMATTER = /^(---\r?\n)([\s\S]*?)\r?\n---/;

/**
 * The sub-language regions of a file, or null when the file is one language.
 *
 * Null and an empty array mean different things: null is "parse the whole file
 * as `language`", empty is "this file has a grammar for none of it".
 */
export function syntaxRegionsFor(source: string, language: Language): SyntaxRegion[] | null {
  if (language === 'razor') {
    return findRazorCodeRegions(source, true).map((region) => ({
      start: region.start,
      end: region.end,
      language: 'csharp',
    }));
  }
  if (language !== 'svelte' && language !== 'vue' && language !== 'astro') return null;

  const regions: SyntaxRegion[] = [];
  if (language === 'astro') {
    const front = ASTRO_FRONTMATTER.exec(source);
    if (front && front[2]) {
      const start = (front[1] as string).length;
      regions.push({ start, end: start + (front[2] as string).length, language: 'typescript' });
    }
  }

  const scriptPattern = /<script(\s[^>]*)?>([\s\S]*?)(?:<\/script>|$)/gi;
  scriptPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(source)) !== null) {
    const body = match[2] ?? '';
    if (body.trim() === '') continue;
    const start = match.index + match[0].indexOf('>') + 1;
    regions.push({
      start,
      end: start + body.length,
      language: TS_LANG_ATTR.test(match[1] ?? '') ? 'typescript' : 'javascript',
    });
  }
  return regions;
}

/* --------------------------------------------------------------- the API -- */

export interface TokenizeResult {
  spans: SyntaxSpan[];
  /** The grammar(s) that produced them, for the payload's `grammar` field. */
  grammars: string[];
}

const NATIVE_SYNTAX_LANGUAGES: ReadonlySet<Language> = new Set([
  'typescript', 'tsx', 'javascript', 'jsx', 'arkts', 'python', 'go', 'java', 'rust', 'kotlin', 'scala',
  'c', 'cpp', 'objc', 'csharp',
  'swift', 'solidity',
  'php', 'ruby', 'lua', 'luau', 'r',
  'dart', 'nix',
  'pascal',
  'vbnet',
  'erlang',
  'terraform',
  'cobol',
  'cfml', 'cfscript', 'cfquery',
]);

/** Whether the Afyx-native syntax classifier supports this language. */
export function supportsNativeSyntax(language: string | undefined | null): boolean {
  return !!language && NATIVE_SYNTAX_LANGUAGES.has(language as Language);
}
const NATIVE_TS_FAMILY_LANGUAGES: ReadonlySet<Language> = new Set([
  'typescript', 'tsx', 'javascript', 'jsx', 'arkts',
]);

const NATIVE_KEYWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  typescript: new Set('as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of package private protected public readonly return set static super switch this throw true try type typeof undefined var void while with yield'.split(' ')),
  arkts: new Set('as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of package private protected public readonly return set static struct super switch this throw true try type typeof undefined var void while with yield'.split(' ')),
  javascript: new Set('as async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield'.split(' ')),
  python: new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' ')),
  go: new Set('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'.split(' ')),
  java: new Set('abstract assert boolean break byte case catch char class const continue default do double else enum exports extends final finally float for goto if implements import instanceof int interface long module native new non-sealed null open opens package permits private protected provides public record requires return sealed short static strictfp super switch synchronized this throw throws to transient transitive true try uses var void volatile while with yield false'.split(' ')),
  rust: new Set('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while union'.split(' ')),
  kotlin: new Set('as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg'.split(' ')),
  scala: new Set('abstract case catch class def do else enum export extends false final finally for forSome given if implicit import lazy match new null object opaque open override package private protected return sealed super then this throw trait transparent true try type val var while with yield extension inline using end derives'.split(' ')),
  c: new Set('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while'.split(' ')),
  cpp: new Set('alignas alignof and and_eq asm auto bitand bitor bool break case catch char class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or override private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile while xor'.split(' ')),
  objc: new Set('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while interface implementation protocol property end selector'.split(' ')),
  csharp: new Set('abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params partial private protected public readonly record ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while yield'.split(' ')),
  swift: new Set('actor any as associatedtype async await break case catch class continue convenience default defer deinit do dynamic else enum extension fallthrough false fileprivate final for func guard if import indirect init in inout internal is isolated let nil nonisolated open operator optional override precedencegroup private protocol public repeat required rethrows return self Self some static struct subscript super switch throw throws true try typealias unowned var weak where while'.split(' ')),
  solidity: new Set('abstract after alias apply auto case catch constant contract default define final immutable implements in inline let macro match mutable null of override partial promise reference relocatable sealed sizeof static supports switch typedef typeof unchecked var address bool break bytes constructor continue delete do else enum error event external fallback false fixed for function if import indexed interface internal is library mapping memory modifier new payable pragma private public pure receive return returns revert storage string struct throw true try using view virtual while'.split(' ')),
  php: new Set('abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield false true null'.split(' ')),
  ruby: new Set('alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield'.split(' ')),
  lua: new Set('and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' ')),
  luau: new Set('and break continue do else elseif end export false for function goto if in local nil not or repeat return then true type typeof until while'.split(' ')),
  r: new Set('break else false for function if in inf na nan next null repeat return true while'.split(' ')),
  dart: new Set('abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null of on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void when while with yield'.split(' ')),
  nix: new Set('assert else false if in inherit let null or rec then true with'.split(' ')),
  pascal: new Set('and array as asm begin case class const constructor destructor div do downto else end except exports file finalization finally for function goto if implementation in inherited initialization inline interface is label library mod nil not object of on operator or out packed procedure program property raise record repeat resourcestring set shl shr string then threadvar to true try type unit until uses var while with xor'.split(' ')),
  vbnet: new Set('addhandler addressof alias and andalso as async boolean byref byte byval call case catch cbool cbyte cchar cdate cdbl cdec char cint class clng const continue csbyte cshort csng cstr ctype cuint culng cushort date decimal declare default delegate dim directcast do double each else elseif end enum erase error event exit false finally for friend function get gettype global gosub goto handles if implements imports in inherits integer interface is isnot iterator let lib like long loop me mod module mustinherit mustoverride mybase myclass namespace narrowing new next not nothing notinheritable notoverridable object of on operator option optional or orelse overloads overridable overrides paramarray partial private property protected public raiseevent readonly redim rem removehandler resume return sbyte select set shadows shared short single static step stop string structure sub synclock then throw to true try trycast typeof uinteger ulong ushort using when while widening with withevents writeonly xor'.split(' ')),
  erlang: new Set('after begin case catch cond end fun if let maybe of receive try when and andalso band bnot bor bsl bsr bxor div not or orelse rem xor module export export_type import include include_lib behaviour behavior compile record type opaque spec callback define'.split(' ')),
  terraform: new Set('for in if else true false null'.split(' ')),
  cobol: new Set('accept access add address advancing after all alphabet alphabetic alphabetic-lower alphabetic-upper alphanumeric alphanumeric-edited also alter alternate and any apply are area areas ascending assign at author before beginning binary blank block bottom by call cancel cd cf ch character characters class close cobol code code-set collating column comma common communication comp comp-1 comp-2 comp-3 comp-4 comp-5 computational computational-1 computational-2 computational-3 computational-4 computational-5 compute configuration contains content continue control controls converting copy corr corresponding count currency data date date-compiled date-written day day-of-week de debug-content debugging declaratives delete delimited delimiter depending descending destination detail display divide division down duplicate duplicates dynamic egcs eject else emi enable end-add end-call end-compute end-delete end-divide end-evaluate end-if end-multiply end-of-page end-perform end-read end-receive end-return end-rewrite end-search end-start end-string end-subtract end-unstring end-write end-exec enter entry environment evaluate every exception exit extend external false fd file file-control filler final first footing for from generate giving global go greater group heading high-value high-values i-o i-o-control identification if in index indexed indicate initial initialize initiate input input-output inspect installation into invalid is just justified key label last leading left length less limit limits linage linage-counter line line-counter lines linkage local-storage lock low-value low-values memory merge message mode modules more-labels move multiple multiply native negative next no not null nulls number numeric numeric-edited object-computer occurs of off omitted on open optional or order organization other output overflow packed-decimal padding page page-counter perform pf ph pic picture plus pointer position positive procedure procedures proceeding program program-id purge queue quote quotes random read receive record recording records recursive redefines reel reference relative release remainder removal renames replacing rerun reserve reset return returning reversed rewind rewrite rounded run same sd search section security segment segment-limit select send sentence separate sequence sequential set sign size sort sort-merge source source-computer spaces special-names standard standard-1 standard-2 start status stop string sub-queue-1 sub-queue-2 sub-queue-3 subtract sum symbolic sync synchronized table tallying tape terminal terminate test text than then through thru time times to top trailing true unit unstring until up upon usage use using value values varying when when-compiled with words working-storage write zero zeroes zeros'.split(' ')),
};

const NATIVE_BUILTIN_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  typescript: new Set('any bigint boolean never number object string symbol unknown void'.split(' ')),
  arkts: new Set('any bigint boolean never number object string symbol unknown void'.split(' ')),
  javascript: new Set(),
  python: new Set(),
  go: new Set('any bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr'.split(' ')),
  java: new Set('boolean byte char double float int long short void String Object'.split(' ')),
  rust: new Set('bool char str u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f32 f64'.split(' ')),
  kotlin: new Set('Any Unit Nothing String Int Long Short Byte Float Double Boolean Char'.split(' ')),
  scala: new Set('Int Long Short Byte Float Double Boolean Char Unit String Any AnyRef AnyVal Nothing Null'.split(' ')),
  c: new Set('void char short int long float double signed unsigned size_t'.split(' ')),
  cpp: new Set('void bool char short int long float double signed unsigned size_t wchar_t'.split(' ')),
  objc: new Set('void BOOL char short int long float double id instancetype NSInteger NSUInteger'.split(' ')),
  csharp: new Set('void bool byte sbyte char short ushort int uint long ulong float double decimal string object dynamic'.split(' ')),
  swift: new Set('Any AnyObject Bool Character Double Float Int Int8 Int16 Int32 Int64 Never String Substring UInt UInt8 UInt16 UInt32 UInt64 Void'.split(' ')),
  solidity: new Set([
    ...'address bool byte bytes fixed string ufixed int uint'.split(' '),
    ...Array.from({ length: 32 }, (_, index) => `uint${(index + 1) * 8}`),
    ...Array.from({ length: 32 }, (_, index) => `int${(index + 1) * 8}`),
    ...Array.from({ length: 32 }, (_, index) => `bytes${index + 1}`),
  ]),
  php: new Set('array bool callable false float int iterable mixed never null object string true void'.split(' ')),
  ruby: new Set(),
  lua: new Set(),
  luau: new Set('any boolean buffer nil never number string thread unknown vector'.split(' ')),
  r: new Set(),
  dart: new Set('bool double dynamic Function Future int List Map Never num Object Record Set String Symbol Type Uri void'.split(' ')),
  nix: new Set(),
  pascal: new Set('Boolean Byte Cardinal Char Currency Double Extended Integer Int64 LongInt LongWord Pointer Real ShortInt Single SmallInt String Variant WideChar WideString Word'.split(' ')),
  vbnet: new Set('boolean byte sbyte char date decimal double integer uinteger long ulong object short ushort single string'.split(' ')),
  erlang: new Set(),
  terraform: new Set(),
  cobol: new Set(),
};

function nativeLanguageKey(language: Language): string {
  if (language === 'tsx') return 'typescript';
  if (language === 'jsx') return 'javascript';
  return language;
}

function nativeTsDefinitionOffsets(source: string, tokens: readonly NativeToken[]): Set<number> {
  const tokenOffsets = new Set(tokens
    .filter((token) => token.kind === 'identifier')
    .map((token) => token.start.offset));
  const offsets = new Set<number>();
  const collect = (pattern: RegExp): void => {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (!name || match.index === undefined) continue;
      if (['if', 'for', 'while', 'switch', 'catch', 'with'].includes(name)) continue;
      const relative = match[0].indexOf(name);
      const offset = match.index + relative;
      if (relative >= 0 && tokenOffsets.has(offset)) offsets.add(offset);
    }
  };
  collect(/\b(?:class|interface|struct|enum|type|function)\s+([A-Za-z_$][\w$]*)/gu);
  collect(/(?:^|[{};])[ \t]*(?:(?:export|default|public|private|protected|static|async|abstract|readonly|declare|override|get|set)\s+)*(?:\*\s*)?([A-Za-z_$][\w$]*)\s*(?:<[^>{}\n]*>)?\s*\([^\n)]*\)\s*(?::[^=>{\n]+)?\s*(?:\{|=>|;)/gmu);
  collect(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^;\n]*?=\s*(?:async\s*)?(?:\([^\n)]*\)|[A-Za-z_$][\w$]*)\s*=>/gu);
  return offsets;
}

function nativeDefinitionOffsets(source: string, language: Language, tokens: readonly NativeToken[]): Set<number> {
  // Syntax highlighting needs declaration names, not the complete graph fact
  // model. Avoid the substantially heavier fact pass for JS/TS source while
  // retaining its declaration forms (named, member, and arrow functions).
  if (NATIVE_TS_FAMILY_LANGUAGES.has(language)) return nativeTsDefinitionOffsets(source, tokens);

  const facts = extractNativeFacts('__syntax__', source, language);
  const definitionKinds = new Set([
    'function', 'method', 'class', 'interface', 'struct', 'enum', 'type_alias', 'trait',
    ...(language === 'cobol' ? ['module', 'variable', 'field', 'constant'] : []),
  ]);
  const definitions = facts.nodes.filter((node) =>
    definitionKinds.has(node.kind));
  const identifiers = new Map<string, NativeToken[]>();
  for (const token of tokens) {
    if (token.kind !== 'identifier') continue;
    const key = `${token.start.line}\0${token.text}`;
    const candidates = identifiers.get(key);
    if (candidates) candidates.push(token);
    else identifiers.set(key, [token]);
  }
  const offsets = new Set<number>();
  for (const node of definitions) {
    const match = identifiers.get(`${node.startLine}\0${node.name}`)
      ?.find((token) => token.start.column >= node.startColumn);
    if (match) offsets.add(match.start.offset);
  }
  return offsets;
}

function classifyNativeRegion(source: string, language: Language, offset: number): SyntaxSpan[] {
  const key = nativeLanguageKey(language);
  const scan = key === 'cobol' ? scanCobolSource(source) : scanSource(source, {
    hashComments: key === 'python' || key === 'ruby' || key === 'r' || key === 'nix' || key === 'terraform',
    rustSyntax: key === 'rust',
    tripleQuotedStrings: key === 'kotlin' || key === 'scala',
    backtickIdentifiers: key === 'kotlin',
    cppRawStrings: key === 'cpp',
    csharpStrings: key === 'csharp',
    swiftSyntax: key === 'swift',
    luaSyntax: key === 'lua' || key === 'luau',
    dartSyntax: key === 'dart',
    nixSyntax: key === 'nix',
    pascalSyntax: key === 'pascal',
    vbnetSyntax: key === 'vbnet',
    erlangSyntax: key === 'erlang',
    hclSyntax: key === 'terraform',
  });
  const definitions = nativeDefinitionOffsets(source, language, scan.tokens);
  const keywords = NATIVE_KEYWORDS[key] ?? new Set<string>();
  const builtins = NATIVE_BUILTIN_TYPES[key] ?? new Set<string>();
  const out: SyntaxSpan[] = [];
  const appendAbsolute = (from: number, to: number, cls: SyntaxTokenClass): void => {
    if (to <= from) return;
    const last = out.at(-1);
    if (last && last.cls === cls && last.end === from) last.end = to;
    else out.push({ start: from, end: to, cls });
  };
  const append = (start: number, end: number, cls: SyntaxTokenClass): void =>
    appendAbsolute(start + offset, end + offset, cls);
  for (let index = 0; index < scan.tokens.length; index += 1) {
    const token = scan.tokens[index]!;
    let cls: SyntaxTokenClass = 'other';
    if (token.kind === 'comment') cls = 'comment';
    else if (token.kind === 'string') {
      if (['typescript', 'javascript'].includes(key) && token.text.startsWith('`') && token.text.includes('${')) {
        let cursor = 0;
        while (cursor < token.text.length) {
          const marker = token.text.indexOf('${', cursor);
          if (marker < 0) {
            append(token.start.offset + cursor, token.end.offset, 'string');
            break;
          }
          append(token.start.offset + cursor, token.start.offset + marker, 'string');
          append(token.start.offset + marker, token.start.offset + marker + 2, 'other');
          let end = marker + 2;
          let depth = 1;
          while (end < token.text.length && depth > 0) {
            if (token.text[end] === '{') depth += 1;
            else if (token.text[end] === '}') depth -= 1;
            end += 1;
          }
          const expressionEnd = depth === 0 ? end - 1 : token.text.length;
          for (const span of classifyNativeRegion(token.text.slice(marker + 2, expressionEnd), language,
            offset + token.start.offset + marker + 2)) {
            appendAbsolute(span.start, span.end, span.cls);
          }
          if (depth === 0) append(token.start.offset + expressionEnd, token.start.offset + end, 'other');
          cursor = end;
        }
        continue;
      }
      cls = 'string';
    }
    else if (token.kind === 'number') cls = key === 'terraform' ? 'other' : 'number';
    else if (token.kind === 'identifier') {
      const caseInsensitive = key === 'vbnet' || key === 'cobol';
      const comparison = caseInsensitive ? token.text.toLowerCase() : token.text;
      const previous = caseInsensitive ? scan.tokens[index - 1]?.text.toLowerCase() : scan.tokens[index - 1]?.text;
      if (definitions.has(token.start.offset)) cls = 'def';
      else if (builtins.has(comparison)) cls = 'type';
      else if ((previous === ':' && key !== 'python' && key !== 'nix') || (key === 'vbnet' && previous === 'as') || previous === 'extends' || previous === 'implements' || previous === 'new') cls = 'type';
      else if (keywords.has(comparison)) cls = ['true', 'false', 'null', 'undefined', 'none', 'nil', 'nothing'].includes(comparison.toLowerCase()) ? 'number' : 'keyword';
      else cls = 'ident';
    }
    append(token.start.offset, token.end.offset, cls);
  }
  return out;
}

/**
 * Parse `source` and classify it.
 *
 * Returns null when nothing in the file has a grammar — a plain answer, which
 * every caller here already knows how to serve. Never throws: a grammar that
 * fails to load or a parse that comes back empty is the same outcome as not
 * having one.
 */
export async function tokenizeSource(
  source: string,
  language: Language
): Promise<TokenizeResult | null> {
  const regions = syntaxRegionsFor(source, language);
  if (regions === null) {
    const spans = tokenizeNativeRegion(source, language, 0);
    return spans ? { spans, grammars: [language] } : null;
  }
  if (regions.length === 0) return null;

  const spans: SyntaxSpan[] = [];
  const grammars = new Set<string>();
  for (const region of regions) {
    const part = tokenizeNativeRegion(
      source.slice(region.start, region.end),
      region.language,
      region.start
    );
    if (!part) continue;
    grammars.add(region.language);
    spans.push(...part);
  }
  if (spans.length === 0) return null;
  spans.sort((a, b) => a.start - b.start);
  return { spans, grammars: [...grammars] };
}

function tokenizeNativeRegion(
  source: string,
  language: Language,
  offset: number
): SyntaxSpan[] | null {
  if (!NATIVE_SYNTAX_LANGUAGES.has(language)) return null;
  if (language === 'cfml' || language === 'cfscript' || language === 'cfquery') {
    return classifyNativeCfmlSyntax(source, language, offset);
  }
  return classifyNativeRegion(source, language, offset);
}
