import { describe, expect, it } from 'vitest';
import { scanSource } from '../src/extraction/native/scanner';

describe('Afyx-native source scanner', () => {
  it('keeps syntax-looking comments and strings opaque', () => {
    const result = scanSource([
      'const real = call();',
      'const text = "function fake() { import hidden }";',
      '// function ignored() {}',
      '/* import alsoIgnored */',
    ].join('\n'));
    const identifiers = result.tokens.filter((token) => token.kind === 'identifier').map((token) => token.text);
    expect(identifiers).toEqual(['const', 'real', 'call', 'const', 'text']);
    expect(result.unterminated).toEqual([]);
  });

  it('uses one-based lines and UTF-16 columns', () => {
    const result = scanSource('😀 value\nnext');
    const value = result.tokens.find((token) => token.text === 'value')!;
    const next = result.tokens.find((token) => token.text === 'next')!;
    expect(value.start).toMatchObject({ line: 1, column: 3, offset: 3 });
    expect(next.start).toMatchObject({ line: 2, column: 0, offset: 9 });
  });

  it('matches balanced delimiters deterministically', () => {
    const result = scanSource('outer({ nested: [1, 2] })');
    const opens = result.tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => ['(', '{', '['].includes(token.text));
    expect(opens.map(({ index }) => result.tokens[result.pairs.get(index)!]?.text)).toEqual([')', '}', ']']);
    expect(result.unterminated).toEqual([]);
  });

  it('terminates and reports incomplete source', () => {
    expect(scanSource('function partial( {').unterminated).toEqual(['delimiter']);
    expect(scanSource('const text = "unfinished').unterminated).toEqual(['string']);
    expect(scanSource('/* unfinished').unterminated).toEqual(['comment']);
  });

  it('keeps C++ raw-string contents opaque and reports an incomplete raw string', () => {
    const complete = scanSource('auto text = R"tag({ fake(); })tag"; real();', { cppRawStrings: true });
    expect(complete.tokens.filter((token) => token.kind === 'identifier').map((token) => token.text))
      .toEqual(['auto', 'text', 'real']);
    expect(complete.unterminated).toEqual([]);
    expect(scanSource('R"tag(unfinished', { cppRawStrings: true }).unterminated).toEqual(['string']);
  });

  it('keeps C# verbatim/interpolated strings opaque, including doubled quotes', () => {
    const result = scanSource('var text = $@"{{ fake() }} says ""hi"""; Real();', { csharpStrings: true });
    expect(result.tokens.filter((token) => token.kind === 'identifier').map((token) => token.text))
      .toEqual(['var', 'text', 'Real']);
    expect(result.unterminated).toEqual([]);
  });

  it('keeps Swift raw/multiline strings and nested comments opaque and bounded', () => {
    const source = '#"fake()"#; """hidden()"""; /* outer /* inner */ done */ real()';
    const result = scanSource(source, { hashComments: false, swiftSyntax: true });
    expect(result.tokens.filter((token) => token.kind === 'identifier').map((token) => token.text)).toEqual(['real']);
    expect(result.unterminated).toEqual([]);
    expect(scanSource('##"unfinished', { hashComments: false, swiftSyntax: true }).unterminated).toEqual(['string']);
  });
});
