import { describe, expect, it } from 'vitest';
import { extractFromSource } from '../src/extraction';

function rawStringSource(delimiter: string): string {
  return `const char* kTemplate = R"${delimiter}(
struct Ignored { int v; };
)${delimiter}";

int after_the_raw_string(int x) {
  return x + 1;
}
`;
}

describe('C++ raw-string delimiter extraction (#1522)', () => {
  it('extracts through a legal 16-character delimiter', () => {
    const result = extractFromSource('min.cpp', rawStringSource('FILE_TEMPLATE_V1'));

    expect(result.nodes.filter((n) => n.kind === 'function').map((n) => n.name))
      .toEqual(['after_the_raw_string']);
    expect(result.errors).toEqual([]);
  });

  it('extracts the function after a 15-character delimiter without warning', () => {
    const result = extractFromSource('min.cpp', rawStringSource('FILE_TEMPLATE_V'));

    expect(result.nodes.filter((n) => n.kind === 'function').map((n) => n.name))
      .toEqual(['after_the_raw_string']);
    expect(result.errors).toEqual([]);
  });

  it.each(['min.cpp', 'min.c', 'min.h'])('does not warn on a healthy include-only %s', (filePath) => {
    const result = extractFromSource(filePath, '#include <stdio.h>\n#include <stdlib.h>\n');

    expect(result.nodes.filter((n) => n.kind !== 'file' && n.kind !== 'import')).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('does not warn on a healthy empty file with zero symbols', () => {
    const result = extractFromSource('empty.cpp', '');

    expect(result.nodes.map((n) => n.kind)).toEqual(['file']);
    expect(result.errors).toEqual([]);
  });

  it('extracts functions on both sides of a raw string without warning', () => {
    const source = 'int before_the_raw_string() { return 0; }\n' + rawStringSource('FILE_TEMPLATE_V1');
    const result = extractFromSource('min.cpp', source);

    expect(result.nodes.filter((n) => n.kind === 'function').map((n) => n.name))
      .toEqual(['before_the_raw_string', 'after_the_raw_string']);
    expect(result.errors).toEqual([]);
  });
});
